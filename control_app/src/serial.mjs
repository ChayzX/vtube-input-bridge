import {checkDeadline} from './deadline.mjs';
export class SerialQueue {
 constructor(){this.tail=Promise.resolve();}
 runWithDeadline(options,fn){return this.run(()=>{checkDeadline(options);return fn();});}
 run(fn){const result=this.tail.then(fn);this.tail=result.catch(()=>{});return result;}
}
