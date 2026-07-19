package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	_ "golang.org/x/image/webp"
)

// Поддерживаемые форматы изображений
var supportedFormats = map[string]bool{
	".jpg":  true,
	".jpeg": true,
	".png":  true,
	".gif":  true,
	".webp": true,
	".avif": true,
}

// Эффекты переходов
const (
	EffectFade     = "fade"
	EffectKenBurns = "kenburns"
	EffectZoom     = "zoom"
	EffectBlur     = "blur"
)

var EffectNames = []string{EffectFade, EffectKenBurns, EffectZoom, EffectBlur}

// EffectsConfig — настройки визуальных эффектов
type EffectsConfig struct {
	Transition string `json:"transition"` // fade, kenburns, zoom, blur
	KenBurns   bool   `json:"kenBurns"`   // медленный zoom во время показа
}

// Config — настройки приложения, сохраняются в %APPDATA%/HushHush/config.json
type Config struct {
	LastFolder string       `json:"lastFolder"`
	Interval   int          `json:"interval"`
	Shuffle    bool         `json:"shuffle"`
	Loop       bool         `json:"loop"`
	Effects    EffectsConfig `json:"effects"`
}

// ImageData — данные изображения для отображения
type ImageData struct {
	Data        string `json:"data"`
	Orientation int    `json:"orientation"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
}

// App — основная структура приложения
type App struct {
	ctx        context.Context
	config     Config
	configPath string
	preloader  *Preloader
}

// NewApp создаёт экземпляр приложения
func NewApp() *App {
	configDir, _ := os.UserConfigDir()
	configPath := filepath.Join(configDir, "HushHush", "config.json")

	app := &App{
		configPath: configPath,
		config: Config{
			Interval: 5,
			Shuffle:  false,
			Loop:     true,
			Effects: EffectsConfig{
				Transition: EffectKenBurns,
				KenBurns:   true,
			},
		},
	}
	app.loadConfig()
	return app
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.preloader = NewPreloader(3)
}

func (a *App) shutdown(ctx context.Context) {
	a.saveConfig()
	if a.preloader != nil {
		a.preloader.Stop()
	}
}

// --- Работа с папкой ---

func (a *App) OpenFolderDialog() string {
	folder, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Выберите папку с изображениями",
		DefaultDirectory:     a.config.LastFolder,
		CanCreateDirectories: false,
	})
	if err != nil || folder == "" {
		return ""
	}
	a.config.LastFolder = folder
	a.saveConfig()
	return folder
}

func (a *App) GetImages(folder string) []string {
	if folder == "" {
		folder = a.config.LastFolder
	}
	if folder == "" {
		return nil
	}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return nil
	}
	var images []string
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if supportedFormats[ext] {
			images = append(images, filepath.Join(folder, entry.Name()))
		}
	}
	sort.Strings(images)
	return images
}

func (a *App) GetLastFolder() string {
	return a.config.LastFolder
}

// --- Настройки ---

func (a *App) GetConfig() Config {
	return a.config
}

func (a *App) SetInterval(seconds int) {
	if seconds < 1 {
		seconds = 1
	}
	if seconds > 3600 {
		seconds = 3600
	}
	a.config.Interval = seconds
	a.saveConfig()
}

func (a *App) SetShuffle(enabled bool) {
	a.config.Shuffle = enabled
	a.saveConfig()
}

func (a *App) SetLoop(enabled bool) {
	a.config.Loop = enabled
	a.saveConfig()
}

func (a *App) SetTransition(name string) {
	found := false
	for _, n := range EffectNames {
		if n == name {
			found = true
			break
		}
	}
	if !found {
		return
	}
	a.config.Effects.Transition = name
	a.saveConfig()
}

func (a *App) SetKenBurns(enabled bool) {
	a.config.Effects.KenBurns = enabled
	a.saveConfig()
}

// --- Предзагрузка ---

func (a *App) PreloadImages(paths []string) {
	if a.preloader != nil {
		a.preloader.Preload(paths)
	}
}

// --- Работа с изображениями ---

func decodeImageConfig(data []byte, ext string) (width, height int) {
	if strings.ToLower(ext) == ".avif" {
		return 0, 0
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
}

func (a *App) GetImageData(path string) ImageData {
	result := ImageData{Data: "", Orientation: 1}
	if path == "" {
		return result
	}
	data := a.preloader.Get(path)
	if data == nil {
		var err error
		data, err = os.ReadFile(path)
		if err != nil {
			return result
		}
	}
	mimeType := mime.TypeByExtension(filepath.Ext(path))
	if mimeType == "" {
		mimeType = "image/jpeg"
	}
	result.Data = "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
	result.Orientation = readExifOrientation(path)
	w, h := decodeImageConfig(data, filepath.Ext(path))
	result.Width = w
	result.Height = h
	if result.Orientation == 6 || result.Orientation == 8 {
		result.Width, result.Height = h, w
	}
	return result
}

// --- Вспомогательные ---

func (a *App) GetCurrentTime() string {
	return time.Now().Format("15:04:05")
}

func (a *App) loadConfig() {
	data, err := os.ReadFile(a.configPath)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &a.config)
	// Валидация переходов
	for _, n := range EffectNames {
		if n == a.config.Effects.Transition {
			// ок
			return
		}
	}
	// Если невалидный — сброс
	a.config.Effects.Transition = EffectKenBurns
}

func (a *App) saveConfig() {
	dir := filepath.Dir(a.configPath)
	_ = os.MkdirAll(dir, 0755)
	data, err := json.MarshalIndent(a.config, "", "  ")
	if err != nil {
		return
	}
	_ = os.WriteFile(a.configPath, data, 0644)
}
