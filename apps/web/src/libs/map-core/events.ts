/** 取消订阅；可以直接登记到释放栈：`stack.defer(unsubscribe)` */
export type Unsubscribe = () => void;
