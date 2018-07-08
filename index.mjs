import path from 'path';
import Plugin from '../../lib/Plugin'

const defaultConfig = {
    "IDLE_TIME": 900000,
    "IDLE_CHANNEL": 1
}

export const VERSION = 1;
export default class IdleCheck extends Plugin {
    constructor() {
        super(defaultConfig);
        this.idleTimers = {};
        this.moveClient = this.moveClient.bind(this);
        this.checkIdleTimes = this.checkIdleTimes.bind(this);
        this.checkIdleTimeout;
    }
    async setup() {
        await this.loadConfig((path.dirname(import.meta.url) + '/config.json'));
        this.connection.registerEvent('server', undefined, {
            notifyclientleftview: (param) => {
                this.clearIdleTimer(param.clid);
            }
        });
        this.checkIdleTimes();
    }
    checkIdleTimes() {
        this.checkIdleTimeout = setTimeout( async ()  => {
            const clientList = await this.connection.store.fetchList('clientlist');
            for (let client of clientList) {
                const data = await this.connection.store.fetchInfo('clientinfo', 'clid', client.clid)
                if (!this.idleTimers[client.clid] && data.client_idle_time > this.config.IDLE_TIME / 2 && client.cid != this.config.IDLE_CHANNEL) {
                    this.idleTimers[client.clid] = setTimeout(this.moveClient, Math.max(this.config.IDLE_TIME - data.client_idle_time, 0), client.clid);
                } else if (this.idleTimers[client.clid]) {
                    this.clearIdleTimer(client.clid);
                }
            }
            this.checkIdleTimeout = setTimeout(this.checkIdleTimes, 1000);
        }, 2000);
    }
    clearIdleTimer(clid) {
        clearTimeout(this.idleTimers[clid]);
        delete this.idleTimers[clid];
    }
    async moveClient(clid) {
        const client = await this.connection.store.fetchInfo('clientinfo', 'clid', clid).then(data => {
            if (data.client_idle_time > this.config.IDLE_TIME) {
                this.connection.send('clientmove', {clid, cid: this.config.IDLE_CHANNEL}, {noOutput: true});
                this.connection.store.forceInfoUpdate('clientinfo', clid, {client_idle_time: 0});
                this.connection.store.forceListUpdate('clientlist', 'clid', clid, {cid: this.config.IDLE_CHANNEL});
            } else if (this.idleTimers[clid]) {
                this.clearIdleTimer(clid);
            }
        });
    }
    reload() {
        console.log("IdleCheck - Already loaded!");
    }
    unload() {
        console.log("IdleCheck - Unloading...");
        clearTimeout(this.checkIdleTimeout);
        for (let clid of Object.keys(this.idleTimers)) {
            this.clearIdleTimer(clid);
        }
    }
}
