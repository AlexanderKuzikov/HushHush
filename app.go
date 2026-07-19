package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"mime"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
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

// Config — настройки приложения, сохраняются в %APPDATA%/HushHush/config.json
type Config struct {
	LastFolder string `json:"lastFolder"`
	Interval   int    `json:"interval"` // секунды между кадрами
	Shuffle    bool   `json:"shuffle"`
	Loop       bool   `json:"loop"`
}

// ImageData — данные изображения для отображения
type ImageData struct {
	Data        string `json:"data"`        // data URI (base64)
	Orientation int    `json:"orientation"` // EXIF ориентация (1-8)
	Width       int    `json:"width"`       // ширина в пикселях
	Height      int    `json:"height"`      // высота в пикселях
}

// App — основная структура приложения
type App struct {
	ctx        context.Context
	config     Config
	configPath string
	preloader  *Preloader
}

// NewApp создаёт экземпляр приложения с настройками по умолчанию
func NewApp() *App {
	configDir, _ := os.UserConfigDir()
	configPath := filepath.Join(configDir, "HushHush", "config.json")

	app := &App{
		configPath: configPath,
		config: Config{
			Interval: 5,
			Shuffle:  false,
			Loop:     true,
		},
	}
	app.loadConfig()
	return app
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.preloader = NewPreloader(3) // предзагрузка 3 следующих кадров
}

func (a *App) shutdown(ctx context.Context) {
	a.saveConfig()
	if a.preloader != nil {
		a.preloader.Stop()
	}
}

// --- Работа с папкой ---

// OpenFolderDialog открывает системный диалог выбора папки
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

// GetImages возвращает список путей к изображениям в папке, отсортированных по имени
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

// GetLastFolder возвращает последнюю открытую папку
func (a *App) GetLastFolder() string {
	return a.config.LastFolder
}

// --- Настройки ---

// GetConfig возвращает текущую конфигурацию
func (a *App) GetConfig() Config {
	return a.config
}

// SetInterval задаёт интервал смены кадров (в секундах, минимум 1)
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

// SetShuffle включает/выключает случайный порядок
func (a *App) SetShuffle(enabled bool) {
	a.config.Shuffle = enabled
	a.saveConfig()
}

// SetLoop включает/выключает зацикливание
func (a *App) SetLoop(enabled bool) {
	a.config.Loop = enabled
	a.saveConfig()
}

// --- Предзагрузка ---

// PreloadImages запускает фоновую предзагрузку следующих N изображений
func (a *App) PreloadImages(paths []string) {
	if a.preloader != nil {
		a.preloader.Preload(paths)
	}
}

// --- Работа с изображениями ---

// decodeImageConfig определяет размеры изображения (без полной декомпрессии)
func decodeImageConfig(data []byte, ext string) (width, height int) {
	ext = strings.ToLower(ext)

	// Для AVIF нет встроенного декодера — пропускаем
	if ext == ".avif" {
		return 0, 0
	}

	// Пробуем стандартные декодеры
	var cfg image.Config
	var err error

	cfg, _, err = image.DecodeConfig(bytes.NewReader(data))

	if err != nil {
		return 0, 0
	}
	return cfg.Width, cfg.Height
}

// GetImageData читает изображение с диска, определяет EXIF-ориентацию,
// размеры и возвращает data URI (base64)
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

	// Определяем размеры изображения
	ext := filepath.Ext(path)
	w, h := decodeImageConfig(data, ext)
	result.Width = w
	result.Height = h

	// Если EXIF говорит о повороте на 90/270 — меняем W/H местами
	if result.Orientation == 6 || result.Orientation == 8 {
		result.Width, result.Height = h, w
	}

	return result
}

// --- Вспомогательные ---

// GetCurrentTime возвращает текущее время (для отладки)
func (a *App) GetCurrentTime() string {
	return time.Now().Format("15:04:05")
}

func (a *App) loadConfig() {
	data, err := os.ReadFile(a.configPath)
	if err != nil {
		return
	}
	_ = json.Unmarshal(data, &a.config)
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
