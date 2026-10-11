import { upsertRows } from "./supabase.js";

export async function desactivateClients(clientArray) {

  clientArray = clientArray.map(c => {
    return {
      id: c.id,
      name: "fraud-" + c.name,
      active: "0"
    }
  })

  try {
    await upsertRows('clients', clientArray);
  } catch (e) {
    console.error(e);
  }
}
