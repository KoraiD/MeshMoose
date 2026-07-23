from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from kittycad import KittyCAD
from kittycad.models.file_import_format import FileImportFormat
from kittycad.models.unit_density import UnitDensity
from kittycad.models.unit_length import UnitLength
from kittycad.models.unit_mass import UnitMass
from kittycad.models.unit_volume import UnitVolume
from kittycad.models.unit_area import UnitArea

from meshmoose_api.logging_util import JobLogger

# PLA-ish density for mass estimates (kg/m³).
DEFAULT_DENSITY_KG_M3 = 1240.0


def _dump(model: Any) -> dict[str, Any]:
    if hasattr(model, "model_dump"):
        return model.model_dump(mode="json")
    if isinstance(model, dict):
        return model
    return {"value": str(model)}


def _measure_one(client: KittyCAD, endpoint: str, data: bytes) -> dict[str, Any]:
    """Call one File Format measure via the official SDK (src_format is a query param)."""
    try:
        if endpoint == "volume":
            return _dump(
                client.file.create_file_volume(
                    src_format=FileImportFormat.STL,
                    body=data,
                    output_unit=UnitVolume.CM3,
                )
            )
        if endpoint == "surface-area":
            return _dump(
                client.file.create_file_surface_area(
                    src_format=FileImportFormat.STL,
                    body=data,
                    output_unit=UnitArea.CM2,
                )
            )
        if endpoint == "center-of-mass":
            return _dump(
                client.file.create_file_center_of_mass(
                    src_format=FileImportFormat.STL,
                    body=data,
                    output_unit=UnitLength.MM,
                )
            )
        if endpoint == "mass":
            return _dump(
                client.file.create_file_mass(
                    src_format=FileImportFormat.STL,
                    material_density=DEFAULT_DENSITY_KG_M3,
                    body=data,
                    material_density_unit=UnitDensity.KG_M3,
                    output_unit=UnitMass.G,
                )
            )
        return {"error": f"unknown endpoint {endpoint}"}
    except Exception as exc:  # noqa: BLE001
        return {"error": str(exc)}


def compare_meshes(
    *,
    token: str,
    reference_stl: Path,
    generated_stl: Path,
    out_json: Path,
    log: JobLogger,
) -> dict[str, Any]:
    log.emit("Measuring reference vs generated via File Format API", kind="measure")
    ref_bytes = reference_stl.read_bytes()
    gen_bytes = generated_stl.read_bytes()
    result: dict[str, Any] = {
        "reference": {},
        "generated": {},
        "delta": {},
        "units": {
            "volume": "cm3",
            "surface-area": "cm2",
            "center-of-mass": "mm",
            "mass": "g",
            "density_assumption": f"{DEFAULT_DENSITY_KG_M3} kg/m3 (PLA-ish)",
        },
    }

    client = KittyCAD(token=token)
    client.headers["User-Agent"] = "MeshMoose.ai/0.1"

    for name in ("volume", "surface-area", "center-of-mass", "mass"):
        result["reference"][name] = _measure_one(client, name, ref_bytes)
        result["generated"][name] = _measure_one(client, name, gen_bytes)
        log.emit(f"Measured {name}", kind="measure")

    for key, field in (
        ("volume", "volume"),
        ("surface-area", "surface_area"),
        ("mass", "mass"),
    ):
        try:
            rv = float(result["reference"][key].get(field))
            gv = float(result["generated"][key].get(field))
            result["delta"][key] = {
                "reference": rv,
                "generated": gv,
                "abs": gv - rv,
                "rel": (gv - rv) / rv if rv else None,
            }
        except Exception:  # noqa: BLE001
            err_r = result["reference"][key].get("error")
            err_g = result["generated"][key].get("error")
            result["delta"][key] = {
                "error": "unavailable",
                "reference_error": err_r,
                "generated_error": err_g,
            }

    out_json.write_text(json.dumps(result, indent=2), encoding="utf-8")
    log.emit(f"Wrote {out_json.name}", kind="measure")
    return result
