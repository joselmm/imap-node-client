export async function desactivateClients(clientArray) {
  
  clientArray = clientArray.map(c=>{
    return {
        id:c.id,
        name:"fraud-"+c.name,
        active:"0"
    }
  })
  //var condition = `@id@ === "${client.id}"`;
  var condition = `@id@ === ROW_OBJECT['id']`;

  //console.log(condition);
  var payload = {
    queryParameters: {
      spreadSheetId: process.env.SS_ID,
      sheetIdType: 'name',
      sheetId: 'clients',
    },
    action: 'UPDATE_IF',
    condition,
    payload: clientArray,
  };
   await fetch(process.env.SHEET_DATA_LIBRARY,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  )
    .then((e) => e.json())
    .then((e) => {})
    .catch((e) => console.error(e));
}