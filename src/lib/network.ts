import * as net from "net";

const userID = Math.floor(Math.random() * Math.pow(2, 52)) + 2;

export default class Network {
    private others: net.Socket[];
    private socket: any;
    private _onremoteEdit: Function;
    private currentObject: string;
    private stackLevel: number;
    private inString: boolean;
    private _currentEdit: Promise<any> = Promise.resolve();
    private _dataProvider: Function;
    _lastRequestOperations: number;
    _siteId: Number;

    get siteId() {
        return this._siteId;
    }


    constructor(siteId = userID, bootstrapIp?) {
        this._siteId = siteId;
        this._lastRequestOperations = new Date().getTime();
        this.others = [];
        this.currentObject = '';
        this.stackLevel = 0;
        this.inString = false;
        this.socket = net.createServer();

        this.socket.listen(() => {
            const port = this.socket.address().port;
            let host = 'localhost';
            console.log('listening on port', port);
            const s = new net.Socket();
            s.connect({
                host: bootstrapIp || process.env.bootstrap || 'localhost',
                port: 3000
            });
            s.on('connect', () => {
                host = s.localAddress;
                s.write(JSON.stringify({ port, host, userID: siteId }));
            })
            s.on('data', data => {
                const otherEndpoints = JSON.parse(data.toString());
                for (let peer of otherEndpoints) {
                    try {
                        const ps = new net.Socket();
                        ps.on('error', err => {
                            console.error(err);
                        })
                        ps.connect(peer);
                        ps.on('connect', () => {
                            this.others.push(ps);
                            this.handleCommand('getOperations', ps);
                            ps.on('close', () => this.others.splice(this.others.indexOf(this.socket), 1));
                            ps.on('data', d => this.handleDataPacket(d.toString(), ps));
                        })
                    } catch (e) {
                        console.log(e);
                    }
                }
            })

        });

        this.socket.on('connection', s => {
            this.others.push(s);
            //when a new client connects we send him all the changes we know of
            this.handleCommand('getOperations', s);
            s.on('close', () => this.others.splice(this.others.indexOf(s), 1));
            s.on('data', d => this.handleDataPacket(d.toString(), s));
            s.on('error', console.error);
        });
    }

    close() {
        this.socket.close();
        for (let o of this.others) {
            o.end();
        }
        this._onremoteEdit = () => { };
    }

    private handleDataPacket(data: string, s: net.Socket) {
        console.info('recieved ' + data);
        //handle recieve multiple json objects at once

        for (let i = 0; i < data.length; i++) {
            this.currentObject += data[i];
            if (data[i] == '"') {
                this.inString = !this.inString;
            }
            if (this.inString) {
                continue;
            }
            if (data[i] == '{') {
                this.stackLevel++;
            }
            else if (data[i] == '}') {
                this.stackLevel--;
            }
            if (this.stackLevel == 0) {
                if (this.currentObject.length > 0) {
                    const toParse = this.currentObject;
                    this._currentEdit = this._currentEdit.then(() => {
                        try {
                            const recieved = JSON.parse(toParse);
                            if (recieved.update) {
                                return this._onremoteEdit(recieved.update);
                            }
                            else if (recieved.command) {
                                return this.handleCommand(recieved.command, s);
                            }
                        } catch (e) {
                            console.error(e);
                            throw e;
                        }
                    })
                }
                this.currentObject = '';
            }
        }
    }

    onRemoteEdit(cb: Function) {
        this._onremoteEdit = cb;
    }

    sendUpdate(update) {
        this.others.forEach(socket => {
            socket.write(JSON.stringify({ update }));
        });
    }

    setDataProviderCallback(cb: Function) {
        this._dataProvider = cb;
    }

    async handleCommand(command: string, s: net.Socket) {
        switch (command) {
            case 'getOperations':
                if (this._dataProvider) {
                    for (let update of this._dataProvider()) {
                        s.write(JSON.stringify({ update }));
                    }
                }
                break;
            default:
                throw new Error('unknown command: ' + command);
        }
    }

    requestRemoteOperations() {
        //give other clients 10 seconds to answer in between requesting stuff
        if (new Date().getTime() - this._lastRequestOperations < 10000) {
            return;
        }
        this._lastRequestOperations = new Date().getTime();
        this.others.forEach(socket => {
            socket.write(JSON.stringify({ command: 'getOperations' }));
        });
    }
}