const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('control',{
 get:()=>ipcRenderer.invoke('control:get'), save:c=>ipcRenderer.invoke('control:save',c),
 exportPair:()=>ipcRenderer.invoke('control:export'), importPair:()=>ipcRenderer.invoke('control:import'),
 login:()=>ipcRenderer.invoke('control:login'), startReactive:()=>ipcRenderer.invoke('control:reactive-start'), stopReactive:()=>ipcRenderer.invoke('control:reactive-stop'),
 command:c=>ipcRenderer.invoke('control:command',c),
 tracking:(name,args)=>ipcRenderer.invoke('tracking:call',name,args)
});
