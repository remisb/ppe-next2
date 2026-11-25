//go:build unix

package extract

import (
	"os/exec"
	"syscall"
)

// ownGroup starts cmd in a process group of its own and makes cancelling it
// kill the whole group, so a tool's children (Tesseract's) die with it.
func ownGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
