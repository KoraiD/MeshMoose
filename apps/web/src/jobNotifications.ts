/** Browser Notification API helpers for job terminal status. */

const ENABLED_KEY = 'meshmoose.notifyJobs'

/** Avoid duplicate alerts for the same job terminal transition. */
const notifiedTerminal = new Set<string>()

export function getJobNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1'
  } catch {
    return false
  }
}

export function setJobNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0')
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function resetNotifiedJobsForTests(): void {
  notifiedTerminal.clear()
}

/**
 * Record a status sample and return true when this is a running→terminal edge
 * that has not been alerted yet.
 */
export function claimJobTerminalTransition(
  jobId: string,
  previousStatus: string | undefined,
  nextStatus: string,
  isRunning: (status: string) => boolean,
): boolean {
  if (nextStatus !== 'succeeded' && nextStatus !== 'failed') return false
  if (!previousStatus || !isRunning(previousStatus)) return false
  const key = `${jobId}:${nextStatus}`
  if (notifiedTerminal.has(key)) return false
  notifiedTerminal.add(key)
  return true
}

export function notifyJobTerminal(job: {
  id: string
  title?: string
  status: string
}): boolean {
  if (!getJobNotificationsEnabled()) return false
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return false
  }
  if (job.status !== 'succeeded' && job.status !== 'failed') return false

  const title = job.title?.trim() || job.id.slice(-12)
  const body =
    job.status === 'succeeded'
      ? `“${title}” finished successfully.`
      : `“${title}” failed.`

  try {
    const n = new Notification(`MeshMoose · ${job.status}`, {
      body,
      tag: `meshmoose-job-${job.id}`,
      // Keep the banner visible until dismissed — otherwise focused tabs often
      // swallow the alert into Notification Center with no on-screen flash.
      requireInteraction: true,
      data: { jobId: job.id },
    })
    n.onclick = () => {
      window.focus()
      const url = new URL(window.location.href)
      url.searchParams.set('job', job.id)
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
      window.dispatchEvent(new CustomEvent('meshmoose:select-job', { detail: job.id }))
      n.close()
    }
    return true
  } catch {
    return false
  }
}
