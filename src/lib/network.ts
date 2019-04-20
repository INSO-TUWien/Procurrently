import * as net from "net";

const userID = Math.floor(Math.random() * Math.pow(2, 64));

export default class Network {
    private others: net.Socket[];
    private socket: any;
    private _onremoteEdit: Function;
    currentObject: string;
    stackLevel: number;
    inString: boolean;

    get siteId(){
        return userID;
    }


    constructor() {
        this.others = [];
        this.currentObject = '';
        this.stackLevel = 0;
        this.inString=false;
        this.socket = net.createServer();

        this.socket.listen(() => {
            const port = this.socket.address().port;
            let host = 'localhost';
            console.log('listening on port', port);
            const s = new net.Socket();
            s.connect({
                host: '192.168.1.18',
                port: 3000
            });
            s.on('connect', () => {
                host = s.localAddress;
                s.write(JSON.stringify({ port, host, userID }));
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
                            ps.on('close', () => this.others.splice(this.others.indexOf(this.socket), 1));
                            ps.on('data', d => this.handleDataPacket(d.toString()));
                        })
                    } catch (e) {
                        console.log(e);
                    }
                }
            })

        });

        this.socket.on('connection', s => {
            this.others.push(s);
            s.on('close', () => this.others.splice(this.others.indexOf(s), 1));
            s.on('data', d => this.handleDataPacket(d.toString()));
            s.on('error', console.error);
        });
    }

    private handleDataPacket(data:string) {
        console.info('recieved '+data);
        //handle recieve multiple json objects at once
        
        for(let i = 0; i < data.length;i++){
            this.currentObject+=data[i];
            if(data[i]=='"'){
                this.inString=!this.inString;
            }
            if(this.inString){
                continue;
            }
            if(data[i]=='{'){
                this.stackLevel++;
            }
            else if(data[i]=='}'){
                this.stackLevel--;
            }
            if(this.stackLevel==0){
                if(this.currentObject.length>0){
                    this._onremoteEdit(JSON.parse(this.currentObject));
                }
                this.currentObject='';
            }
        }
    }

    onRemoteEdit(cb:Function){
        this._onremoteEdit = cb;
    }

    sendUpdate(update) {
        this.others.forEach(socket => {
            socket.write(JSON.stringify(update));
        });
    }
}