import fs from "fs";
import archiver from "archiver";

async function compressSessions() {
  const backupDir = "./backups";
  const outputPath = `${backupDir}/backup.zip`;

  // Crear carpeta backups si no existe
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const output = fs.createWriteStream(outputPath);
  const archive = archiver("zip", { zlib: { level: 9 } });

  output.on("close", () => {
    console.log(`✅ Backup creado correctamente: ${outputPath}`);
    console.log(`🗜️  Tamaño total: ${archive.pointer()} bytes`);
  });

  archive.on("warning", (err) => {
    if (err.code === "ENOENT") {
      console.warn("⚠️ Archivo no encontrado (ignorado):", err.message);
    } else {
      console.warn("⚠️ Advertencia:", err.message);
    }
  });

  archive.on("error", (err) => {
    console.error("❌ Error al comprimir:", err.message);
  });

  archive.pipe(output);

  // === Carpeta de caché (.wwebjs_cache) ===
  const cacheFolder = ".wwebjs_cache";
  if (fs.existsSync(cacheFolder)) {
    console.log(`📦 Añadiendo carpeta: ${cacheFolder}`);
    archive.glob("**/*", {
      cwd: cacheFolder,
      dot: true,
      ignore: [
        "**/*.pma",
        "**/LOCK",
        "**/LOG",
        "**/LOG.old",
        "**/CURRENT",
        "**/DevToolsActivePort",
        "**/*.tmp",
      ],
    }, { prefix: cacheFolder });
  } else {
    console.warn(`⚠️ Carpeta no encontrada: ${cacheFolder}`);
  }

  // === Carpeta de sesiones (wa-sessions) ===
  const sessionsFolder = "wa-sessions";
  if (fs.existsSync(sessionsFolder)) {
    console.log(`📦 Añadiendo carpeta: ${sessionsFolder}`);
    archive.glob("**/*", {
      cwd: sessionsFolder,
      dot: true,
      ignore: [
        "**/*.pma",
        "**/LOCK",
        "**/LOG",
        "**/LOG.old",
        "**/CURRENT",
        "**/DevToolsActivePort",
        "**/*.tmp",
      ],
    }, { prefix: sessionsFolder });
  } else {
    console.warn(`⚠️ Carpeta no encontrada: ${sessionsFolder}`);
  }

  await archive.finalize();
}

compressSessions().catch((err) => {
  console.error("❌ Error global:", err.message);
});
