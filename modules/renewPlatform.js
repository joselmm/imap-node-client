import fetch from 'node-fetch';
import dotenv from 'dotenv';
import { updatePlatforms } from './platformFunctions.js';
dotenv.config();

function getConfig() {
  const dbUri = process.env.SHEET_DATA_LIBRARY;
  const sheetId = process.env.SS_ID;
  if (!dbUri) throw new Error('Falta SHEET_DATA_LIBRARY en .env');
  if (!sheetId) throw new Error('Falta SS_ID en .env');
  return { dbUri, sheetId };
}

export function calculateRenewalDates(platform) {
  const updated = { ...platform };
  updated.lastBillingDate = updated.nextBillingDate;

  const lastDate = new Date(updated.lastBillingDate);
  const usageTime = Number(updated.usageTime) || 30;
  const typeOfSum = updated.typeOfSum || 'days';

  const nextDate = new Date(lastDate);
  if (typeOfSum === 'months') {
    nextDate.setMonth(nextDate.getMonth() + usageTime);
  } else {
    nextDate.setDate(nextDate.getDate() + usageTime);
  }

  updated.nextBillingDate = nextDate.toISOString();
  return updated;
}

export async function renewPlatform(platform) {
  const { dbUri, sheetId } = getConfig();
  const updatedPlatform = calculateRenewalDates(platform);

  const payload = {
    queryParameters: {
      spreadSheetId: sheetId,
      sheetIdType: 'name',
      sheetId: 'platforms',
    },
    action: 'UPDATE_IF',
    condition: `@id@ === "${platform.id}"`,
    payload: [updatedPlatform],
  };

  const res = await fetch(dbUri, {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function renewMultiplePlatforms(platforms) {
  const updatedPlatforms = platforms.map(p => calculateRenewalDates(p));
  const res = await updatePlatforms(updatedPlatforms);
  return res.data;
}