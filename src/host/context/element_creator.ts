import {IElement, ElementOptions} from './element';

export type ElementCreator = (options: ElementOptions) => IElement;

class ElementRegister {
    private m_eList: Map<string, ElementCreator> = new Map();

    get(name: string): ElementCreator | undefined {
        return this.m_eList.get(name);
    }

    register(name: string, cb: ElementCreator) {
        this.m_eList.set(name, cb);
    }
}

let elementRegister = new ElementRegister();
export {elementRegister};