import express from 'express';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode';

const { Client, LocalAuth } = pkg;


const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;

var qrCodeData = null;
let isReady = false;

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: "./wa-sessions/"+process.env.OWNER
  }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
  },
  syncFullHistoy:false
});

client.on('qr', (qr) => {
  qrCodeData = "" + qr;
  console.log('🔹 Nuevo QR generado.');
});

client.on('ready', () => {
  console.log('✅ Cliente de WhatsApp listo!');
  isReady = true;
});

client.on('message', async (msg) => {
  // Ignorar mensajes del propio bot
  if (msg.fromMe) return;

  // Ignorar grupos (los JID de grupos terminan en @g.us)
  if (msg.from.endsWith('@g.us')) return;

  // Solo ejecuta si el propietario (desde tu .env) es "leiner"
  if (process.env.TYPE_OF_BOT === 'bot') {
    await msg.reply(`📢 *Atención*

Este número no gestiona ventas. Este número *solo se usa para enviar códigos y links de verificación (no lo borres de tus contactos)*.

Si estás interesado en adquirir plataformas de streaming, comunícate directamente con nuestro vendedor:  
👇👇👇  
https://wa.me/`+ process.env.WHATSAPP_CONTACT);
  }

  // Aquí podrías agregar tu lógica para otros mensajes
});

export function connectToWhatsApp() {
  client.initialize();
  // === SERVIDOR ===
  app.listen(port, () => {
    console.log(`🚀 Servidor Express en http://localhost:${port}/qr`);
  });


}


// 🧩 === MÉTODO PARA ENVIAR MENSAJES ===
export async function sendMessage(numeroConPrefijo, mensaje) {
  try {
    if (!isReady) throw new Error('El cliente de WhatsApp no está listo aún.');

    // Asegura que el número tenga formato correcto sin símbolos (+, -, etc.)
    const numero = numeroConPrefijo.replace(/\D/g, ''); // quita todo excepto dígitos
    const chatId = `${numero}@c.us`; // formato requerido por WhatsApp Web

    await client.sendMessage(chatId, mensaje);
    console.log(`📤 Mensaje enviado a ${numero}: ${mensaje}`);
    return { success: true, numero, mensaje };
  } catch (error) {
    console.error('❌ Error enviando mensaje:', error.message);
    return { success: false, error: error.message };
  }
}

// 🧠 === ENDPOINT PARA PROBAR DESDE HTTP ===
app.post('/send', async (req, res) => {
  const { numero, mensaje } = req.body;

  if (!numero || !mensaje) {
    return res.status(400).json({ error: 'Faltan parámetros: numero o mensaje' });
  }

  const resultado = await sendMessage(numero, mensaje);
  res.json(resultado);
});

// === QR ENDPOINT ===
app.get('/qr', async (req, res) => {
  if (isReady) return res.send('<h2>✅ Cliente conectado a WhatsApp</h2>');
  if (!qrCodeData) return res.send('<h2>Esperando generación del QR...</h2>');

  const qrImage = await qrcode.toDataURL(qrCodeData);
  res.send(`<h2>Escanea este QR con WhatsApp</h2><img src="${qrImage}" />`);
});


