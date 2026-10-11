const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('control',{
 get:()=>ipcRenderer.invoke('control:get'), save:c=>ipcRenderer.invoke('control:save',c),
 exportPair:()=>ipcRenderer.invoke('control:export'), importPair:()=>ipcRenderer.invoke('control:import'),
 login:()=>ipcRenderer.invoke('control:login'), startReactive:()=>ipcRenderer.invoke('control:reactive-start'), stopReactive:()=>ipcRenderer.invoke('control:reactive-stop'),
 command:c=>ipcRenderer.invoke('control:command',c),
 tracking:(name,args)=>ipcRenderer.invoke('tracking:call',name,args),
 metrics:options=>ipcRenderer.invoke('control:metrics',options),
 pairStart:()=>ipcRenderer.invoke('pair:start'), pairStatus:()=>ipcRenderer.invoke('pair:status'), pairCancel:()=>ipcRenderer.invoke('pair:cancel'),
 pairFind:()=>ipcRenderer.invoke('pair:find'), pairJoin:value=>ipcRenderer.invoke('pair:join',value),
 updateGet:()=>ipcRenderer.invoke('update:get'), updateCheck:()=>ipcRenderer.invoke('update:check'), updateChooseFile:()=>ipcRenderer.invoke('update:choose-file'), updateInstall:value=>ipcRenderer.invoke('update:install',value),
 logs:options=>ipcRenderer.invoke('control:logs',options), setLogging:value=>ipcRenderer.invoke('control:set-logging',value), openLogFolder:()=>ipcRenderer.invoke('control:open-log-folder')
});
