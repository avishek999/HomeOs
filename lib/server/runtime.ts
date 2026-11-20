export function assertNonRoot(uid: number | undefined) {
  if (uid === 0) {
    throw new Error("HomeOS must run as a non-root user.")
  }
}
