package main

import (
	"archive/zip"
	"bufio"
	"bytes"
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"runtime"
	"strings"
)

//go:embed payload.zip
var payload []byte

//go:embed payload.sha256
var expectedDigest string

const maxFileBytes = 16 * 1024 * 1024
const maxPayloadBytes = 64 * 1024 * 1024

func confirm(reader *bufio.Reader, question string) bool {
	fmt.Print(question + " [y/N]: ")
	answer, err := reader.ReadString('\n')
	if err != nil {
		return false
	}
	answer = strings.ToLower(strings.TrimSpace(answer))
	return answer == "y" || answer == "yes"
}

func safeTarget(root, name string) (string, error) {
	if name == "" || strings.ContainsAny(name, "\\:") || path.IsAbs(name) ||
		path.Clean(name) != name || name == ".." || strings.HasPrefix(name, "../") {
		return "", fmt.Errorf("unsafe packaged path: %q", name)
	}
	target := filepath.Join(root, filepath.FromSlash(name))
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("path escapes the app folder: %q", name)
	}
	return target, nil
}

func ensureDirectory(root, dir string) error {
	relative, err := filepath.Rel(root, dir)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("invalid installation directory")
	}
	paths := []string{root}
	current := root
	if relative != "." {
		for _, part := range strings.Split(relative, string(filepath.Separator)) {
			current = filepath.Join(current, part)
			paths = append(paths, current)
		}
	}
	for _, item := range paths {
		info, err := os.Lstat(item)
		if os.IsNotExist(err) {
			if err := os.MkdirAll(item, 0755); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
			return fmt.Errorf("installation path is not a regular directory: %s", item)
		}
	}
	return nil
}

func extract(data []byte, root string) error {
	archive, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return err
	}
	seen := make(map[string]bool)
	var total uint64
	for _, file := range archive.File {
		if file.FileInfo().IsDir() || file.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("unexpected directory or symbolic link: %s", file.Name)
		}
		if _, err := safeTarget(root, file.Name); err != nil {
			return err
		}
		key := strings.ToLower(file.Name)
		if seen[key] {
			return fmt.Errorf("duplicate packaged filename: %s", file.Name)
		}
		seen[key] = true
		if file.UncompressedSize64 > maxFileBytes {
			return fmt.Errorf("packaged file is too large: %s", file.Name)
		}
		total += file.UncompressedSize64
		if total > maxPayloadBytes {
			return errors.New("packaged application exceeds the size limit")
		}
	}
	for _, file := range archive.File {
		target, _ := safeTarget(root, file.Name)
		if err := ensureDirectory(root, filepath.Dir(target)); err != nil {
			return err
		}
		if info, err := os.Lstat(target); err == nil {
			if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
				return fmt.Errorf("refusing to replace a non-regular file: %s", target)
			}
		} else if !os.IsNotExist(err) {
			return err
		}
		stream, err := file.Open()
		if err != nil {
			return err
		}
		contents, readErr := io.ReadAll(io.LimitReader(stream, maxFileBytes+1))
		closeErr := stream.Close()
		if readErr != nil {
			return readErr
		}
		if closeErr != nil {
			return closeErr
		}
		if len(contents) > maxFileBytes {
			return errors.New("packaged file exceeds its declared size")
		}
		if err := os.WriteFile(target, contents, 0644); err != nil {
			return err
		}
	}
	return nil
}

func validatePayload() error {
	hash := sha256.Sum256(payload)
	if hex.EncodeToString(hash[:]) != strings.TrimSpace(expectedDigest) {
		return errors.New("embedded application checksum did not match")
	}
	archive, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return err
	}
	required := map[string]bool{
		"app/main.py": false, "requirements.txt": false, "Setup.ps1": false,
		"Launch.ps1": false, "BMG.CLIP-V3.vbs": false, "web/dist/index.html": false,
	}
	for _, file := range archive.File {
		if _, ok := required[file.Name]; ok {
			required[file.Name] = true
		}
	}
	for name, present := range required {
		if !present {
			return fmt.Errorf("missing packaged application file: %s", name)
		}
	}
	return nil
}

func install(reader *bufio.Reader) error {
	if runtime.GOOS != "windows" {
		return errors.New("this installer must run on 64-bit Windows 10 or 11")
	}
	if err := validatePayload(); err != nil {
		return err
	}
	local := os.Getenv("LOCALAPPDATA")
	if local == "" || !filepath.IsAbs(local) {
		return errors.New("Windows did not provide a valid LOCALAPPDATA folder")
	}
	destination := filepath.Join(local, "Programs", "BMG.CLIP-V3-Preview")
	fmt.Println("BMG.CLIP-V3 Windows Setup - Preview")
	fmt.Println("Includes the updated app: blur-strength control and free caption dragging.")
	fmt.Println("This is an unsigned online installer. Internet access is required for packages.")
	fmt.Println("Missing Python and FFmpeg will require separate confirmation.")
	fmt.Println("Your existing videos and models will not be deleted.")
	fmt.Printf("\nInstallation folder: %s\n", destination)
	if _, err := os.Lstat(destination); err == nil {
		fmt.Println("An existing preview folder was found. Continuing updates its program files.")
	} else if !os.IsNotExist(err) {
		return err
	}
	if !confirm(reader, "Install the app files and continue to dependency setup?") {
		fmt.Println("Cancelled. No app files or dependencies were installed.")
		return nil
	}
	if err := extract(payload, destination); err != nil {
		return fmt.Errorf("extracting the app: %w", err)
	}
	fmt.Println("\nApp files installed. Starting guided dependency and desktop-shortcut setup...")
	command := exec.Command("powershell.exe", "-NoLogo", "-NoProfile",
		"-ExecutionPolicy", "Bypass", "-File", filepath.Join(destination, "Setup.ps1"), "-BootstrapMode")
	command.Dir = destination
	// Pass the console handle directly so exec.Wait cannot block on a stdin
	// copying goroutine after the setup process exits.
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("dependency setup did not finish: %w\nApp files and setup logs are in %s. Run Setup.cmd there to retry", err, destination)
	}
	fmt.Println("\nSetup finished. Use the BMG.CLIP-V3 Preview desktop shortcut to open the app.")
	return nil
}

func main() {
	reader := bufio.NewReader(os.Stdin)
	err := install(reader)
	if err != nil {
		fmt.Fprintln(os.Stderr, "\nSETUP ERROR:", err)
	}
	fmt.Print("\nPress Enter to close this window...")
	_, _ = reader.ReadString('\n')
	if err != nil {
		os.Exit(1)
	}
}
