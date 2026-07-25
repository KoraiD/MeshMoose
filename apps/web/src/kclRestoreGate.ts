import { isJobRunning } from './jobTiming'

/** Restore needs an idle job — versions can exist even if main.kcl is missing. */
export function canRestoreKclVersion(
  job: { status: string } | null | undefined,
): boolean {
  return Boolean(job && !isJobRunning(job.status))
}
