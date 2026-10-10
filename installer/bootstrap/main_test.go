package main

import (
	"archive/zip"
	"bytes"
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

func archiveWith(t *testing.T, name, content string, mode os.FileMode) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	header := &zip.FileHeader{Name: name, Method: zip.Deflate}
	header.SetMode(mode)
	file, err := writer.CreateHeader(header)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = file.Write([]byte(content)); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func TestEmbeddedPayload(t *testing.T) {
	if err := validatePayload(); err != nil {
		t.Fatal(err)
	}
	root := filepath.Join(t.TempDir(), "app")
	if err := extract(payload, root); err != nil {
		t.Fatal(err)
	}
for _, name := range []string{"app/main.py", "app/clipper.py", "Setup.ps1", "web/dist/index.html", "app/canvas_captions.py", "caption_renderer/driver.mjs", "caption_renderer/engine.mjs", "caption_renderer/catalog.json", "assets/fonts/Inter.ttf"} {
		if _, err := os.Stat(filepath.Join(root, filepath.FromSlash(name))); err != nil {
			t.Fatal(name, err)
		}
	}
	index, err := os.ReadFile(filepath.Join(root, "web", "dist", "index.html"))
	if err != nil {
		t.Fatal(err)
	}
	assets := regexp.MustCompile(`/assets/[^"']+\.(js|css)`).FindAllString(string(index), -1)
	if len(assets) < 2 {
		t.Fatal("built dashboard does not reference its JS and CSS bundles")
	}
	for _, asset := range assets {
		if _, err := os.Stat(filepath.Join(root, "web", "dist", filepath.FromSlash(asset[1:]))); err != nil {
			t.Fatal("missing dashboard bundle", asset, err)
		}
	}
}

func TestPreservesUserDataOnUpdate(t *testing.T) {
	root := t.TempDir()
	model := filepath.Join(root, "models", "keep.txt")
	if err := os.MkdirAll(filepath.Dir(model), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(model, []byte("personal model"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "README.md"), []byte("old app file"), 0644); err != nil {
		t.Fatal(err)
	}
	if err := extract(archiveWith(t, "README.md", "new app file", 0644), root); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(model)
	if err != nil || string(got) != "personal model" {
		t.Fatal("User data was changed", err)
	}
}

func TestRejectsUnsafePaths(t *testing.T) {
	for _, name := range []string{"../escape", "/escape", "C:/escape", "app\\escape", "app/../escape"} {
		t.Run(name, func(t *testing.T) {
			if err := extract(archiveWith(t, name, "bad", 0644), t.TempDir()); err == nil {
				t.Fatal("unsafe path was accepted")
			}
		})
	}
}

func TestRejectsArchiveSymlinks(t *testing.T) {
	if err := extract(archiveWith(t, "README.md", "../outside", os.ModeSymlink|0777), t.TempDir()); err == nil {
		t.Fatal("archive symlink was accepted")
	}
}

func TestRejectsExistingSymlinkDirectory(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "app")); err != nil {
		t.Skip("platform does not allow symlinks:", err)
	}
	if err := extract(archiveWith(t, "app/main.py", "bad", 0644), root); err == nil {
		t.Fatal("existing symlink directory was accepted")
	}
	if _, err := os.Stat(filepath.Join(outside, "main.py")); !os.IsNotExist(err) {
		t.Fatal("file was written outside the installation folder")
	}
}
