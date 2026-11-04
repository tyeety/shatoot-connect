'use strict';
// Windows can reserve the preferred port (EACCES), even with no listener.
// Keep a previously working port; advertise the actual port through discovery.
async function listenDirect(create,preferred=8788){
  if(!Number.isInteger(preferred)||preferred<0||preferred>65535)preferred=8788;
  const ports=preferred===0?[0]:[...new Set([preferred,8788,28788,38788,48788,0])];
  for(const port of ports){
    const service=create(port);
    try{await service.listen();return service;}
    catch(error){
      await service.close().catch(()=>{});
      if(!['EACCES','EADDRINUSE'].includes(error.code)||port===ports.at(-1))throw error;
    }
  }
}
module.exports={listenDirect};
