/**
 * The client handles connecting to PS and logging in.
 */

import * as websocket from 'websocket';
import * as qs from 'querystring';
import * as https from 'https';
import * as url from 'url';
import { toID } from './util';

const THROTTLE = 100; // TODO - support nontrusted

export type MessageCallback = (roomid: RoomID, messages: string[]) => void;

export class Client {
    private challstr: string = '';
    private client: websocket.client;
    private connection: websocket.connection | null = null;
    messageCallback: MessageCallback | null;
    private sendQueue: Promise<void> = Promise.resolve();
    private credentials: {name: string, pass: string}; 
    loggedIn: boolean = false;
    constructor(credentials: {name: string, pass: string}, messageCallback: MessageCallback | null = null) {
        this.messageCallback = messageCallback;
        this.credentials = credentials;
        this.client = new websocket.client();
        this.client.on('connect', connection => {
            this.connection = connection;
            connection.on('message', (message: websocket.IMessage) => this.onMessage(message));
            connection.on('error', this.onError.bind(this));
            connection.on('close', this.onClose.bind(this));
            this.onConnect();
        });
    }
    connect() {
        this.client.connect(`wss://sim3.psim.us:443/showdown/websocket`);
    }
    onConnect() {
        console.log(`Client connected.`);
    }
    onMessage(data: websocket.IMessage) {
        if (data.type !== 'utf8' || !data.utf8Data) return;
        console.log(`recv: ${data.utf8Data}`);

        const lines = data.utf8Data.split('\n');
        let roomid = lines[0]?.charAt(0) === '>' ?
            lines.shift()?.slice(1) as RoomID :
            'lobby';
    
        for (const line of lines) {
            if (line.startsWith('|challstr|')) {
                this.challstr = line.slice(10);
                this.login();
                break;
            } else if (line.startsWith('|updateuser|')) {
                const [/*nothing*/, /*updateuser*/, name, registered, avatar, ...json] = line.split('|');
                if (name.slice(1) === this.credentials.name) {
                    if (!this.loggedIn) console.log(`Logged in as ${name}!`);
                    this.loggedIn = true;
                    // todo - check if we're trusted
                } else if (toID(name) === toID(this.credentials.name)) {
                    this.send(`|/trn ${this.credentials.name}`);
                }
            }
        }
        if (this.loggedIn) this.messageCallback?.(roomid, lines);

    }
    login() {
        if (!this.challstr) throw new Error(`logging in with no challstr`);
        const actionUrl = url.parse(`https://play.pokemonshowdown.com/~~showdown/action.php`);
        
        const query = qs.stringify({
            act: 'login',
            name: this.credentials.name,
            pass: this.credentials.pass,
            challstr: this.challstr,
        });
        const options = {
            hostname: actionUrl.hostname,
            path: actionUrl.pathname,
            agent: false,
            method: 'POST',
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "Content-Length": query.length,
            },
        };
        const req = https.request(options, res => {
            res.setEncoding('utf-8');
            let data = '';
            res.on('data', d => data += d);
            res.on('end', () => {
                const assertion = JSON.parse(data.substr(1));
                if (!assertion.actionsuccess) throw new Error(`action failed: ${data}`);
                this.send(`|/trn ${this.credentials.name},0,${assertion.assertion}`);
            });
        });
        req.write(query);
        req.end();
    }

    send(message: string) {
        if (!this.connection) throw new Error(`no connection`);
        this.sendQueue = this.sendQueue.then(() => {
            this.connection!.send(message);
            return new Promise(resolve => setTimeout(resolve, THROTTLE));
        });
    }

    onError(...e: any[]) {
        throw new Error(`socket error: ${e}`);
    }
    onClose(...e: any[]) {
        throw new Error(`socket close: ${e}`);
    }
}