export class SerialQueue {
 constructor(){this.tail=Promise.resolve();}
 run(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
}
