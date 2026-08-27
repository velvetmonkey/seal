// SPDX-License-Identifier: Apache-2.0
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/sysctl.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/user.h>

int main(int argc, char *argv[]) {
  char *end = NULL;
  long parsed;
  int boot_mib[] = { CTL_KERN, KERN_BOOTTIME };
  int process_mib[] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, 0 };
  struct timeval boot;
  struct kinfo_proc process;
  size_t boot_len = sizeof(boot);
  size_t process_len = sizeof(process);

  if (argc != 2) return 1;
  parsed = strtol(argv[1], &end, 10);
  if (end == argv[1] || *end != '\0' || parsed <= 0 || parsed > INT_MAX) return 1;
  process_mib[3] = (int)parsed;

  /* Exit 2 lets the caller distinguish an unavailable boot-time source. */
  if (sysctl(boot_mib, 2, &boot, &boot_len, NULL, 0) != 0) return 2;
  if (boot_len != sizeof(boot) || boot.tv_sec <= 0 ||
      boot.tv_usec < 0 || boot.tv_usec > 999999) return 2;

  if (sysctl(process_mib, 4, &process, &process_len, NULL, 0) != 0) return 1;
  if (process_len != sizeof(process)) return 1;
  if (process.kp_proc.p_starttime.tv_sec <= 0 ||
      process.kp_proc.p_starttime.tv_usec < 0 ||
      process.kp_proc.p_starttime.tv_usec > 999999) return 1;

  printf("boot %lld.%06d\n", (long long)boot.tv_sec, boot.tv_usec);
  printf("process %lld.%06d\n", (long long)process.kp_proc.p_starttime.tv_sec,
      process.kp_proc.p_starttime.tv_usec);
  return 0;
}
