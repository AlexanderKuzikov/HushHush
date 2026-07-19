package main

import (
	"encoding/binary"
	"os"
)

// readExifOrientation читает EXIF-ориентацию из JPEG файла
// Возвращает 1 если ориентация не найдена (1 = нормальная)
func readExifOrientation(path string) int {
	f, err := os.Open(path)
	if err != nil {
		return 1
	}
	defer f.Close()

	// Читаем заголовок JPEG (первые 64KB должно хватить для EXIF)
	buf := make([]byte, 65536)
	n, err := f.Read(buf)
	if err != nil || n < 4 {
		return 1
	}
	buf = buf[:n]

	// Проверяем JPEG signature
	if buf[0] != 0xFF || buf[1] != 0xD8 {
		return 1
	}

	pos := 2
	for pos < len(buf)-1 {
		if buf[pos] != 0xFF {
			break
		}
		marker := buf[pos+1]
		if marker == 0xD8 || marker == 0xD9 {
			pos += 2
			continue
		}
		if pos+3 >= len(buf) {
			break
		}
		length := int(buf[pos+2])<<8 | int(buf[pos+3])
		if length < 2 {
			break
		}

		// APP1 marker (0xFFE1) содержит EXIF
		if marker == 0xE1 && pos+8 < len(buf) {
			exifBuf := buf[pos+2 : pos+2+length]
			if len(exifBuf) < 8 {
				pos += 2 + length
				continue
			}
			// Проверяем "Exif\0\0" или "Exif\0"
			if string(exifBuf[:6]) == "Exif\000\000" || string(exifBuf[:5]) == "Exif\000" {
				offset := 6
				if string(exifBuf[:5]) == "Exif\000" {
					offset = 5
				}
				tiffHeader := exifBuf[offset:]
				if len(tiffHeader) < 8 {
					pos += 2 + length
					continue
				}
				// Определяем порядок байт (II = Little, MM = Big)
				var bo binary.ByteOrder
				if tiffHeader[0] == 'I' && tiffHeader[1] == 'I' {
					bo = binary.LittleEndian
				} else if tiffHeader[0] == 'M' && tiffHeader[1] == 'M' {
					bo = binary.BigEndian
				} else {
					pos += 2 + length
					continue
				}

				if len(tiffHeader) < 12 {
					pos += 2 + length
					continue
				}

				// Offset to IFD0 from TIFF header start
				ifdOffset := int(bo.Uint32(tiffHeader[4:8]))
				if ifdOffset+2 > len(tiffHeader) {
					pos += 2 + length
					continue
				}

				// Читаем IFD0
				numEntries := int(bo.Uint16(tiffHeader[ifdOffset : ifdOffset+2]))
				ifdEntriesStart := ifdOffset + 2

				for i := 0; i < numEntries; i++ {
					entryOffset := ifdEntriesStart + i*12
					if entryOffset+12 > len(tiffHeader) {
						break
					}
					tag := bo.Uint16(tiffHeader[entryOffset : entryOffset+2])
					// Tag 0x0112 = Orientation
					if tag == 0x0112 {
						dataType := bo.Uint16(tiffHeader[entryOffset+2 : entryOffset+4])
						_ = dataType
						// Для orientation значение хранится прямо в поле value (первые 2 байта из 4)
						orientation := int(tiffHeader[entryOffset+8])
						if orientation >= 1 && orientation <= 8 {
							return orientation
						}
						return 1
					}
				}
			}
		}

		pos += 2 + length
	}

	return 1
}
