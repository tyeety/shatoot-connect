'use strict';
module.exports=async({host,app,log})=>{
  const result=await host.webContents.executeJavaScript(`(async()=>{
    const peer=new RTCPeerConnection({iceServers:[]}),candidates=[];peer.createDataChannel('ice-vpn-probe');
    try{await new Promise(async(resolve,reject)=>{const timer=setTimeout(()=>reject(Error('ICE gathering timed out')),12000);peer.onicecandidate=event=>{if(event.candidate)candidates.push(event.candidate.toJSON());else{clearTimeout(timer);resolve();}};try{await peer.setLocalDescription(await peer.createOffer());}catch(error){clearTimeout(timer);reject(error);}});
      return candidates.map(c=>{const fields=c.candidate.split(' ');return {protocol:fields[2],address:fields[4],port:Number(fields[5]),type:fields[7]};});
    }finally{peer.close();}
  })()`);
  if(!result.some(c=>c.type==='host'&&c.protocol.toLowerCase()==='udp'&&/^\d+\.\d+\.\d+\.\d+$/.test(c.address)))throw Error('No usable numeric IPv4 host ICE candidate');
  if(result.some(c=>/\.local\.?$/i.test(c.address)))throw Error('ICE still depends on link-local mDNS');
  log('Numeric host ICE candidates: '+JSON.stringify(result));console.log('SHATOOTCONNECT_ICE_SMOKE '+JSON.stringify(result));app.quit();
};
