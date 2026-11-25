//go:build !unix

package extract

import "os/exec"

// ownGroup leaves cmd as it is: the worker runs on Linux.
func ownGroup(cmd *exec.Cmd) {}
