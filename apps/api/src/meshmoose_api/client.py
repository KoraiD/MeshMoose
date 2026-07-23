"""HTTP client for the MeshMoose local API (shared by CLI + tests)."""

from __future__ import annotations

import json
import mimetypes
import time
from pathlib import Path
from typing import Any, BinaryIO
from urllib.parse import quote

import httpx


class MeshMooseError(Exception):
    """Raised when the API returns a non-success response."""

    def __init__(self, status_code: int, detail: str, *, method: str, path: str):
        self.status_code = status_code
        self.detail = detail
        self.method = method
        self.path = path
        super().__init__(f"HTTP {status_code} {method} {path}: {detail}")


class MeshMooseClient:
    """Thin client over the MeshMoose FastAPI surface."""

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8787",
        token: str | None = None,
        *,
        timeout: float = 60.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = (token or "").strip()
        self._client = httpx.Client(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
        )

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> MeshMooseClient:
        return self

    def __exit__(self, *args: object) -> None:
        self.close()

    def _headers(self, *, auth: bool = True) -> dict[str, str]:
        headers: dict[str, str] = {"Accept": "application/json"}
        if auth:
            if not self.token:
                raise MeshMooseError(
                    401,
                    "API token required (set --token or ZOO_API_TOKEN)",
                    method="*",
                    path="*",
                )
            headers["Authorization"] = f"Bearer {self.token}"
        return headers

    def _request(
        self,
        method: str,
        path: str,
        *,
        auth: bool = True,
        **kwargs: Any,
    ) -> Any:
        headers = self._headers(auth=auth)
        extra = kwargs.pop("headers", None)
        if extra:
            headers.update(extra)
        res = self._client.request(method, path, headers=headers, **kwargs)
        if res.status_code >= 400:
            detail = res.text
            try:
                body = res.json()
                if isinstance(body, dict) and "detail" in body:
                    detail = (
                        body["detail"]
                        if isinstance(body["detail"], str)
                        else json.dumps(body["detail"])
                    )
            except Exception:  # noqa: BLE001
                pass
            raise MeshMooseError(res.status_code, detail, method=method, path=path)
        if res.status_code == 204 or not res.content:
            return None
        ctype = res.headers.get("content-type", "")
        if "application/json" in ctype:
            return res.json()
        return res.content

    def health(self) -> dict[str, Any]:
        return self._request("GET", "/health", auth=False)

    def usage(self) -> dict[str, Any]:
        return self._request("GET", "/zoo/usage")

    def list_demos(self) -> list[dict[str, Any]]:
        return self._request("GET", "/demos", auth=False)

    def list_jobs(self) -> list[dict[str, Any]]:
        return self._request("GET", "/jobs")

    def get_job(self, job_id: str, *, hydrate: bool = True) -> dict[str, Any]:
        # Server hydrates by default for GET /jobs/{id}
        _ = hydrate
        return self._request("GET", f"/jobs/{quote(job_id)}")

    def delete_job(self, job_id: str) -> dict[str, Any]:
        return self._request("DELETE", f"/jobs/{quote(job_id)}")

    def cancel_job(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/jobs/{quote(job_id)}/cancel")

    def retry_job(self, job_id: str) -> dict[str, Any]:
        return self._request("POST", f"/jobs/{quote(job_id)}/retry")

    def patch_job(
        self,
        job_id: str,
        *,
        title: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if tags is not None:
            body["tags"] = tags
        return self._request("PATCH", f"/jobs/{quote(job_id)}", json=body)

    def list_artifacts(self, job_id: str) -> list[dict[str, Any]]:
        return self._request("GET", f"/jobs/{quote(job_id)}/artifacts")

    def download_file(self, job_id: str, relative_path: str) -> bytes:
        path = f"/jobs/{quote(job_id)}/files/{relative_path.lstrip('/')}"
        res = self._client.get(path, headers=self._headers())
        if res.status_code >= 400:
            raise MeshMooseError(
                res.status_code,
                res.text,
                method="GET",
                path=path,
            )
        return res.content

    def create_job(
        self,
        *,
        prompt: str,
        photos: list[Path | str],
        meshes: list[Path | str],
        mode: str = "thoughtful",
        title: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        files: list[tuple[str, tuple[str, BinaryIO, str]]] = []
        opened: list[BinaryIO] = []
        try:
            for p in photos:
                path = Path(p)
                fh = path.open("rb")
                opened.append(fh)
                mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                files.append(("photos", (path.name, fh, mime)))
            for p in meshes:
                path = Path(p)
                fh = path.open("rb")
                opened.append(fh)
                mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                files.append(("meshes", (path.name, fh, mime)))
            data: dict[str, str] = {"prompt": prompt, "mode": mode}
            if title:
                data["title"] = title
            if tags:
                data["tags"] = ",".join(tags)
            return self._request("POST", "/jobs", data=data, files=files)
        finally:
            for fh in opened:
                fh.close()

    def create_job_from_demo(
        self,
        demo_id: str,
        *,
        mode: str = "thoughtful",
        prompt: str | None = None,
    ) -> dict[str, Any]:
        data: dict[str, str] = {"mode": mode}
        if prompt is not None:
            data["prompt"] = prompt
        return self._request("POST", f"/jobs/from-demo/{quote(demo_id)}", data=data)

    def refine_job(
        self,
        job_id: str,
        *,
        message: str,
        photos: list[Path | str] | None = None,
        meshes: list[Path | str] | None = None,
    ) -> dict[str, Any]:
        files: list[tuple[str, tuple[str, BinaryIO, str]]] = []
        opened: list[BinaryIO] = []
        try:
            for p in photos or []:
                path = Path(p)
                fh = path.open("rb")
                opened.append(fh)
                mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                files.append(("photos", (path.name, fh, mime)))
            for p in meshes or []:
                path = Path(p)
                fh = path.open("rb")
                opened.append(fh)
                mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
                files.append(("meshes", (path.name, fh, mime)))
            data = {"message": message}
            return self._request(
                "POST",
                f"/jobs/{quote(job_id)}/refine",
                data=data,
                files=files or None,
            )
        finally:
            for fh in opened:
                fh.close()

    def list_finishes(self) -> list[dict[str, Any]]:
        return self._request("GET", "/finishes")

    def apply_finish(self, job_id: str, *, preset: str) -> dict[str, Any]:
        return self._request(
            "POST",
            f"/jobs/{quote(job_id)}/finish",
            data={"preset": preset},
        )

    def wait_job(
        self,
        job_id: str,
        *,
        timeout: float = 900.0,
        poll_interval: float = 2.0,
        on_status: Any | None = None,
    ) -> dict[str, Any]:
        deadline = time.time() + timeout
        last: str | None = None
        while time.time() < deadline:
            meta = self.get_job(job_id)
            status = str(meta.get("status") or "")
            if status != last:
                if on_status:
                    on_status(status, meta)
                last = status
            if status in {"succeeded", "failed"}:
                return meta
            time.sleep(poll_interval)
        raise TimeoutError(f"Timed out after {timeout}s waiting for job {job_id}")
