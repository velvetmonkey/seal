// SPDX-License-Identifier: Apache-2.0
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/sysctl.h>
#include <sys/types.h>
#include <sys/user.h>

int main(int argc, char *argv[]) {
  char *end = NULL;
  long parsed;
  int mib[] = { CTL_KERN, KERN_PROC, KERN_PROC_PID, 0 };
  struct kinfo_proc process;
  size_t len = sizeof(process);

  if (argc != 2) return 1;
  parsed = strtol(argv[1], &end, 10);
  if (end == argv[1] || *end != '\0' || parsed <= 0 || parsed > INT_MAX) return 1;
  mib[3] = (int)parsed;

  if (sysctl(mib, 4, &process, &len, NULL, 0) != 0) return 1;
  if (len != sizeof(process)) return 1;
  if (process.kp_proc.p_starttime.tv_sec == 0) return 1;

  printf("%lld.%06d\n", (long long)process.kp_proc.p_starttime.tv_sec,
      process.kp_proc.p_starttime.tv_usec);
  return 0;
}
