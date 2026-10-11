import dotenv from 'dotenv';
import { updateRows, eq } from './supabase.js';
import { updatePlatforms } from './platformFunctions.js';

dotenv.config();

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
  const updatedPlatform = calculateRenewalDates(platform);
  const data = await updateRows('platforms', [eq('id', platform.id)], updatedPlatform);
  return { noError: true, data };
}

export async function renewMultiplePlatforms(platforms) {
  const updatedPlatforms = platforms.map(p => calculateRenewalDates(p));
  const res = await updatePlatforms(updatedPlatforms);
  return res.data;
}
