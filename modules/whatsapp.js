let lastTimeConected = null;
let backupTimer = null;
let isBackingUp = false;
let reconnectDelay = 2000; // ms, aumentaremos con backoff si falla

export async function connectToWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState("./auth_info");
  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.windows('Browser'),
    markOnlineOnConnect: false,
    syncFullHistory: false
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, pairingCode: code } = update;

    // QR / pairing
    if (qr) {
      try {
        qrCodeBase64 = await QRCode.toDataURL(qr);
        pairingCode = "";
        console.log("📱 Escanea el QR en: http://localhost:" + port + "/qr");
      } catch (err) {
        console.error("Error generando QR:", err);
      }
    }
    if (code) {
      pairingCode = code;
      qrCodeBase64 = "";
      console.log(`🔢 Código de vinculación: ${code}`);
    }

    if (connection === "open") {
      console.log("✅ Conectado a WhatsApp");
      // registrar tiempo y (re)programar backup estable (debounce)
      lastTimeConected = Date.now();

      // si ya había un timer, cancelarlo (evita duplicados)
      if (backupTimer) {
        clearTimeout(backupTimer);
        backupTimer = null;
      }

      // programar backup tras 10s de estabilidad
      backupTimer = setTimeout(async () => {
        // protección contra backups concurrentes
        if (isBackingUp) {
          console.log("Backup ya en progreso, salto.");
          return;
        }

        // comprobamos que hace >=10s desde la última apertura
        if (lastTimeConected && (Date.now() - lastTimeConected) >= 10000) {
          isBackingUp = true;
          try {
            console.log("Pasaron 10 segundos — guardando session en drive...");
            await uploadFolderZipToGAS();
            console.log("✅ Se subió el archivo de sesión a GAS desde WhatsApp");
          } catch (err) {
            console.error("Error subiendo archivo sesion a GAS:", err?.message || err);
          } finally {
            isBackingUp = false;
          }
        } else {
          console.log("No se cumplen 10s de estabilidad, se omite backup.");
        }
      }, 10000);

      // resetear pairing/qr
      qrCodeBase64 = "";
      pairingCode = "";

      // reset reconnectDelay si se conectó bien
      reconnectDelay = 2000;
    } else if (connection === "close") {
      // cancelar timers / flags al desconectar
      if (backupTimer) {
        clearTimeout(backupTimer);
        backupTimer = null;
      }
      lastTimeConected = null;
      isBackingUp = false;

      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log("⚠️ Desconectado.", shouldReconnect ? "Reconectando..." : "Sesión cerrada.");

      if (shouldReconnect) {
        // reintento con backoff exponencial (no await recursivo directo)
        setTimeout(() => {
          // incrementa el delay con un tope para evitar bucles agresivos
          reconnectDelay = Math.min(reconnectDelay * 1.5, 60000);
          connectToWhatsApp().catch(err => console.error("Error re-conectando:", err));
        }, reconnectDelay);
      }
    }
  });
}
