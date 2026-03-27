export type PingMessage = {
    type : "ping";
    mainSendTime : number;
    seq : number;
};

export type PongMessage = {
    type : "pong";
    mainSendTime : number;
    workerReceiveTime : number;
    workerSendTime : number;
    workerSelfLag : number;
    seq : number;
};

export type ConfigMessage = {
    type : "config";
    intervalMs : number;
};

export type StopMessage = {
    type : "stop";
};

export type MainToWorkerMessage = PingMessage | ConfigMessage | StopMessage;
export type WorkerToMainMessage = PongMessage;
