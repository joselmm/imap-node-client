export function getFormattedDate() {
  const date = new Date();
  var day   = date.getDate(); // 1–31
  
  const year  = date.getFullYear();
  // Array de meses en abreviatura de tres letras
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                  
  const monthAbbr = months[date.getMonth()];
  
  return `${day}-${monthAbbr}-${year}`;
}

//