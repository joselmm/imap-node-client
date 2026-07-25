import fetch from 'node-fetch';
import dotenv from 'dotenv';
dotenv.config();

function getConfig() {
  const dbUri = process.env.SHEET_DATA_LIBRARY;
  const sheetId = process.env.SS_ID;
  if (!dbUri) throw new Error('Falta SHEET_DATA_LIBRARY en .env');
  if (!sheetId) throw new Error('Falta SS_ID en .env');
  return { dbUri, sheetId };
}

export async function fetchPlatformTemplate() {
  const { dbUri, sheetId } = getConfig();

  const payload = {
    queryParameters: {
      spreadSheetId: sheetId,
      sheetIdType: 'name',
      sheetId: 'reminderOptions',
    },
    action: 'GET_IF',
    condition: "@settings@ ==='default'",
  };

  const res = await fetch(dbUri, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();

  if (json.data && json.data[0]?.reminderOptions) {
    const settings = JSON.parse(json.data[0].reminderOptions);
    return settings.platformInfo?.message || '';
  }
  return '';
}

function capitalizeFirstLetter(val) {
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

function parseDate(ISODateString) {
  const date = new Date(ISODateString);
  const monthNames = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
  ];
  return {
    date: date.getDate(),
    fullYear: date.getFullYear(),
    month: monthNames[date.getMonth()],
  };
}

export function remplazarEtiquetas(platform, client, template, updateType = null, platformNames = []) {
  let result = template;
  const primerNombre = client.name?.includes(' ') ? client.name.split(' ')[0] : client.name || '';
  const fechaInicio = parseDate(platform.lastBillingDate);
  const fechaVence = parseDate(platform.nextBillingDate);

  const fechaInicioParsed =
    `${fechaInicio.date} ${capitalizeFirstLetter(fechaInicio.month)}` +
    (new Date().getFullYear() !== fechaInicio.fullYear ? ' ' + fechaInicio.fullYear : '');

  const fechaVenceParsed =
    `${fechaVence.date} ${capitalizeFirstLetter(fechaVence.month)}` +
    (new Date().getFullYear() !== fechaVence.fullYear ? ' ' + fechaVence.fullYear : '');

  const precio = platform.price % 1000 === 0 ? platform.price / 1000 : platform.price;
  const pantallaOCuenta = platform.fullAccount === '1' ? '(Cuenta Completa)' : '(1 Pantalla)';
  const platformName = platformNames.find(pn => pn.id === platform.platformNameId)?.platformName || '';

  const regexPassChanged = /\n?@ifpasschanges{[^}]*}/g;
  const regexCredsChanged = /\n?@ifcredschange{[^}]*}/g;
  const regexRenewal = /\n?@sirenovacion{[^}]*}/g;

  if (updateType === 'creds') {
    result = result.replace(regexPassChanged, '');
    result = result.replace(regexRenewal, '');
    const match = result.match(regexCredsChanged);
    if (match) {
      const onlyText = match[0].split('{')[1].slice(0, -1);
      result = result.replace(match[0], onlyText);
    }
  } else if (updateType === 'pass') {
    result = result.replace(regexCredsChanged, '');
    result = result.replace(regexRenewal, '');
    const match = result.match(regexPassChanged);
    if (match) {
      const onlyText = match[0].split('{')[1].slice(0, -1);
      result = result.replace(match[0], onlyText);
    }
  } else if (updateType === 'renewal') {
    result = result.replace(regexCredsChanged, '');
    result = result.replace(regexPassChanged, '');
    const match = result.match(regexRenewal);
    if (match) {
      const onlyText = match[0].split('{')[1].slice(0, -1);
      result = result.replace(match[0], onlyText);
    }
  } else {
    result = result.replace(regexPassChanged, '');
    result = result.replace(regexCredsChanged, '');
    result = result.replace(regexRenewal, '');
  }

  const pairs = [
    { tag: '@NombreCliente@', value: primerNombre },
    { tag: '@FechaInicio@', value: fechaInicioParsed },
    { tag: '@FechaVence@', value: fechaVenceParsed },
    { tag: '@Precio@', value: precio },
    { tag: '@Password@', value: platform.password || '' },
    { tag: '@NombrePlataforma@', value: platformName },
    { tag: '@CuentaOPantalla@', value: pantallaOCuenta },
    { tag: '@Email@', value: platform.email || '' },
  ];

  let mensaje = pairs.reduce((acc, pair) => acc.replaceAll(pair.tag, String(pair.value)), result);

  const optionalSentenceRegex = /{[^{}@]*@\w+@[^{@}]*}/g;
  const tagRegex = /@\w+@/g;
  const ifTags = [
    { tag: '@SiNombrePerfil@', propertyName: 'profileName' },
    { tag: '@SiPinPerfil@', propertyName: 'profilePin' },
  ];

  if (optionalSentenceRegex.test(mensaje)) {
    const matches = mensaje.match(optionalSentenceRegex);
    matches.forEach((foundOptionalSentence) => {
      const foundTag = foundOptionalSentence.match(tagRegex)[0];
      const ifTag = ifTags.find(t => t.tag === foundTag);
      if (!ifTag || !platform[ifTag.propertyName]) {
        mensaje = borrarSentencia(foundOptionalSentence, mensaje);
      } else {
        const theSentence = foundOptionalSentence.slice(1, -1).replaceAll(ifTag.tag, platform[ifTag.propertyName]);
        mensaje = mensaje.replace(foundOptionalSentence, theSentence);
      }
    });
  }

  return mensaje.trim();
}

function borrarSentencia(foundOptionalSentence, mensaje) {
  const regexLineBreakBefore = /\n *$/g;
  const regexLineBreakAfter = /^ *\n/g;
  const index = mensaje.indexOf(foundOptionalSentence);
  const matchBreakLineBefore = mensaje.slice(0, index).match(regexLineBreakBefore);
  const matchBreakLineAfter = mensaje.slice(index + foundOptionalSentence.length).match(regexLineBreakAfter);

  if (matchBreakLineAfter && matchBreakLineBefore) {
    mensaje = mensaje.replace(matchBreakLineBefore[0] + foundOptionalSentence + matchBreakLineAfter[0], '\n');
  } else {
    mensaje = mensaje.replace(foundOptionalSentence, '');
  }
  return mensaje;
}