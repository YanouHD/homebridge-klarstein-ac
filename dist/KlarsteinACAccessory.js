"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KlarsteinACAccessory = void 0;
const axios_1 = __importDefault(require("axios"));
const crypto_1 = __importDefault(require("crypto"));
class KlarsteinACAccessory {
    constructor(log, config, api) {
        this.accessToken = "";
        this.apiBase = "https://openapi.tuyaeu.com/v1.0";
        this.log = log;
        this.name = config.name || "Klarstein AC";
        this.deviceId = config.deviceId;
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.hap = api.hap;
        // Service d'information de l'accessoire
        this.infoService = new this.hap.Service.AccessoryInformation()
            .setCharacteristic(this.hap.Characteristic.Manufacturer, "Klarstein")
            .setCharacteristic(this.hap.Characteristic.Model, "Tuya AC Multi-Mode")
            .setCharacteristic(this.hap.Characteristic.SerialNumber, this.deviceId);
        // Service climatiseur/chauffage (modes cool et auto)
        this.heaterCoolerService = new this.hap.Service.HeaterCooler(`${this.name} Climatiseur`);
        // Service ventilateur (mode fan)
        this.fanService = new this.hap.Service.Fan(`${this.name} Ventilateur`);
        // Service déshumidificateur (mode dry)
        this.dehumidifierService = new this.hap.Service.HumidifierDehumidifier(`${this.name} Déshumidificateur`);
        // Service mode sommeil
        this.sleepModeService = new this.hap.Service.Switch(`${this.name} Mode Sommeil`);
        this.initAllCharacteristics();
    }
    generateUUID() {
        return crypto_1.default.randomUUID();
    }
    createSignature(httpMethod, url, body = "") {
        const t = Date.now().toString();
        const nonce = this.generateUUID().replace(/-/g, "");
        const contentSHA256 = crypto_1.default
            .createHash("sha256")
            .update(body)
            .digest("hex");
        const optionalSignatureKey = "";
        const stringToSign = httpMethod +
            "\n" +
            contentSHA256 +
            "\n" +
            optionalSignatureKey +
            "\n" +
            url;
        const str = this.clientId + t + nonce + stringToSign;
        const sign = crypto_1.default
            .createHmac("sha256", this.clientSecret)
            .update(str)
            .digest("hex")
            .toUpperCase();
        return { sign, t, nonce };
    }
    createBusinessSignature(httpMethod, url, body = "") {
        const t = Date.now().toString();
        const nonce = this.generateUUID().replace(/-/g, "");
        const contentSHA256 = crypto_1.default
            .createHash("sha256")
            .update(body)
            .digest("hex");
        const optionalSignatureKey = "";
        const stringToSign = httpMethod +
            "\n" +
            contentSHA256 +
            "\n" +
            optionalSignatureKey +
            "\n" +
            url;
        const str = this.clientId + this.accessToken + t + nonce + stringToSign;
        const sign = crypto_1.default
            .createHmac("sha256", this.clientSecret)
            .update(str)
            .digest("hex")
            .toUpperCase();
        return { sign, t, nonce };
    }
    async getAccessToken() {
        const url = "/v1.0/token?grant_type=1";
        const { sign, t, nonce } = this.createSignature("GET", url);
        try {
            const response = await axios_1.default.get(`${this.apiBase}/token?grant_type=1`, {
                headers: {
                    client_id: this.clientId,
                    sign: sign,
                    t: t,
                    sign_method: "HMAC-SHA256",
                    nonce: nonce,
                },
            });
            if (!response.data?.result?.access_token) {
                throw new Error("Kein access_token in der Antwort enthalten");
            }
            this.accessToken = response.data.result.access_token;
            this.log.info("✅ Access Token erhalten");
        }
        catch (err) {
            this.log.error("❌ Token-Fehler:", err?.response?.data || err?.message || err);
        }
    }
    async getStatus() {
        await this.getAccessToken();
        const url = `/v1.0/devices/${this.deviceId}/status`;
        const { sign, t, nonce } = this.createBusinessSignature("GET", url);
        try {
            const res = await axios_1.default.get(`${this.apiBase}/devices/${this.deviceId}/status`, {
                headers: {
                    client_id: this.clientId,
                    access_token: this.accessToken,
                    sign: sign,
                    t: t,
                    sign_method: "HMAC-SHA256",
                    nonce: nonce,
                },
            });
            const status = {};
            for (const dp of res.data.result) {
                status[dp.code] = dp.value;
            }
            return status;
        }
        catch (err) {
            this.log.error("❌ Erreur getStatus:", err?.response?.data || err?.message || err);
            return {};
        }
    }
    async setStatus(code, value) {
        await this.getAccessToken();
        const url = `/v1.0/devices/${this.deviceId}/commands`;
        const body = JSON.stringify({ commands: [{ code, value }] });
        const { sign, t, nonce } = this.createBusinessSignature("POST", url, body);
        try {
            await axios_1.default.post(`${this.apiBase}/devices/${this.deviceId}/commands`, {
                commands: [{ code, value }],
            }, {
                headers: {
                    client_id: this.clientId,
                    access_token: this.accessToken,
                    sign: sign,
                    t: t,
                    sign_method: "HMAC-SHA256",
                    nonce: nonce,
                    "Content-Type": "application/json",
                },
            });
            this.log.info(`🔁 Set ${code} = ${value}`);
        }
        catch (err) {
            this.log.error("❌ Erreur setStatus:", err?.response?.data || err?.message || err);
        }
    }
    async getCurrentMode() {
        try {
            const status = await this.getStatus();
            return status.mode || "cool";
        }
        catch (err) {
            this.log.error("❌ Erreur getCurrentMode:", err);
            return "cool";
        }
    }
    async setMode(mode) {
        try {
            await this.setStatus("mode", mode);
            this.log.info(`🔄 Mode changé vers: ${mode}`);
        }
        catch (err) {
            this.log.error("❌ Erreur setMode:", err);
        }
    }
    initAllCharacteristics() {
        this.initHeaterCoolerCharacteristics();
        this.initFanCharacteristics();
        this.initDehumidifierCharacteristics();
        this.initSleepModeCharacteristics();
    }
    initHeaterCoolerCharacteristics() {
        const { Characteristic } = this.hap;
        // Active - contrôle l'alimentation générale
        this.heaterCoolerService
            .getCharacteristic(Characteristic.Active)
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                const currentMode = status.mode || "cool";
                return status.power &&
                    (currentMode === "cool" || currentMode === "auto")
                    ? Characteristic.Active.ACTIVE
                    : Characteristic.Active.INACTIVE;
            }
            catch (err) {
                this.log.error("❌ Erreur HeaterCooler Active onGet:", err);
                return Characteristic.Active.INACTIVE;
            }
        })
            .onSet(async (value) => {
            try {
                const isActive = value === Characteristic.Active.ACTIVE;
                if (isActive) {
                    await this.setStatus("power", true);
                    await this.setMode("cool"); // Activer en mode climatiseur
                }
                else {
                    await this.setStatus("power", false);
                }
            }
            catch (err) {
                this.log.error("❌ Erreur HeaterCooler Active onSet:", err);
            }
        });
        // Température de refroidissement cible
        this.heaterCoolerService
            .getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 32, minStep: 1 })
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return status.temp_c_set || 22;
            }
            catch (err) {
                this.log.error("❌ Erreur CoolingThresholdTemperature onGet:", err);
                return 22;
            }
        })
            .onSet(async (value) => {
            try {
                await this.setStatus("temp_c_set", value);
                // Synchroniser avec la température de chauffage
                this.heaterCoolerService.updateCharacteristic(Characteristic.HeatingThresholdTemperature, value);
            }
            catch (err) {
                this.log.error("❌ Erreur CoolingThresholdTemperature onSet:", err);
            }
        });
        // État cible (refroidissement/auto) - Limiter aux options COOL et AUTO seulement
        this.heaterCoolerService
            .getCharacteristic(Characteristic.TargetHeaterCoolerState)
            .setProps({
            validValues: [
                Characteristic.TargetHeaterCoolerState.AUTO,
                Characteristic.TargetHeaterCoolerState.COOL,
            ],
        })
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return status.mode === "auto"
                    ? Characteristic.TargetHeaterCoolerState.AUTO
                    : Characteristic.TargetHeaterCoolerState.COOL;
            }
            catch (err) {
                this.log.error("❌ Erreur TargetHeaterCoolerState onGet:", err);
                return Characteristic.TargetHeaterCoolerState.COOL;
            }
        })
            .onSet(async (value) => {
            try {
                const mode = value === Characteristic.TargetHeaterCoolerState.AUTO
                    ? "auto"
                    : "cool";
                await this.setMode(mode);
            }
            catch (err) {
                this.log.error("❌ Erreur TargetHeaterCoolerState onSet:", err);
            }
        });
        // État actuel
        this.heaterCoolerService
            .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                const currentMode = status.mode || "cool";
                if (!status.power ||
                    (currentMode !== "cool" && currentMode !== "auto")) {
                    return Characteristic.CurrentHeaterCoolerState.INACTIVE;
                }
                return Characteristic.CurrentHeaterCoolerState.COOLING;
            }
            catch (err) {
                this.log.error("❌ Erreur CurrentHeaterCoolerState onGet:", err);
                return Characteristic.CurrentHeaterCoolerState.INACTIVE;
            }
        });
        // Température actuelle
        this.heaterCoolerService
            .getCharacteristic(Characteristic.CurrentTemperature)
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return status.temp_c_set || 22; // Utilisé comme température actuelle
            }
            catch (err) {
                this.log.error("❌ Erreur CurrentTemperature onGet:", err);
                return 22;
            }
        });
        // Température de chauffage (identique à la température de refroidissement pour le mode AUTO)
        this.heaterCoolerService
            .getCharacteristic(Characteristic.HeatingThresholdTemperature)
            .setProps({ minValue: 18, maxValue: 32, minStep: 1 })
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return status.temp_c_set || 22;
            }
            catch (err) {
                this.log.error("❌ Erreur HeatingThresholdTemperature onGet:", err);
                return 22;
            }
        })
            .onSet(async (value) => {
            try {
                await this.setStatus("temp_c_set", value);
                // Synchroniser avec la température de refroidissement
                this.heaterCoolerService.updateCharacteristic(Characteristic.CoolingThresholdTemperature, value);
            }
            catch (err) {
                this.log.error("❌ Erreur HeatingThresholdTemperature onSet:", err);
            }
        });
        // Vitesse de rotation
        this.heaterCoolerService
            .getCharacteristic(Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 33 })
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                switch (status.speed) {
                    case "low":
                        return 33;
                    case "mid":
                        return 66;
                    case "high":
                        return 100;
                    default:
                        return 66;
                }
            }
            catch (err) {
                this.log.error("❌ Erreur HeaterCooler RotationSpeed onGet:", err);
                return 66;
            }
        })
            .onSet(async (value) => {
            try {
                let speed = "mid";
                const num = Number(value);
                if (num >= 84)
                    speed = "high";
                else if (num >= 50)
                    speed = "mid";
                else
                    speed = "low";
                await this.setStatus("speed", speed);
            }
            catch (err) {
                this.log.error("❌ Erreur HeaterCooler RotationSpeed onSet:", err);
            }
        });
    }
    initFanCharacteristics() {
        const { Characteristic } = this.hap;
        // Ventilateur On/Off
        this.fanService
            .getCharacteristic(Characteristic.On)
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return status.power && status.mode === "fan";
            }
            catch (err) {
                this.log.error("❌ Erreur Fan On onGet:", err);
                return false;
            }
        })
            .onSet(async (value) => {
            try {
                if (value) {
                    await this.setStatus("power", true);
                    await this.setMode("fan");
                }
                else {
                    await this.setStatus("power", false);
                }
            }
            catch (err) {
                this.log.error("❌ Erreur Fan On onSet:", err);
            }
        });
        // Vitesse du ventilateur
        this.fanService
            .getCharacteristic(Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 33 })
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                if (!status.power || status.mode !== "fan")
                    return 0;
                switch (status.speed) {
                    case "low":
                        return 33;
                    case "mid":
                        return 66;
                    case "high":
                        return 100;
                    default:
                        return 66;
                }
            }
            catch (err) {
                this.log.error("❌ Erreur Fan RotationSpeed onGet:", err);
                return 0;
            }
        })
            .onSet(async (value) => {
            try {
                if (Number(value) > 0) {
                    let speed = "mid";
                    const num = Number(value);
                    if (num >= 84)
                        speed = "high";
                    else if (num >= 50)
                        speed = "mid";
                    else
                        speed = "low";
                    await this.setStatus("speed", speed);
                }
            }
            catch (err) {
                this.log.error("❌ Erreur Fan RotationSpeed onSet:", err);
            }
        });
    }
    initDehumidifierCharacteristics() {
        const { Characteristic } = this.hap;
        // Déshumidificateur On/Off
        this.dehumidifierService
            .getCharacteristic(Characteristic.Active)
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return status.power && status.mode === "dry"
                    ? Characteristic.Active.ACTIVE
                    : Characteristic.Active.INACTIVE;
            }
            catch (err) {
                this.log.error("❌ Erreur Dehumidifier Active onGet:", err);
                return Characteristic.Active.INACTIVE;
            }
        })
            .onSet(async (value) => {
            try {
                const isActive = value === Characteristic.Active.ACTIVE;
                if (isActive) {
                    await this.setStatus("power", true);
                    await this.setMode("dry");
                }
                else {
                    await this.setStatus("power", false);
                }
            }
            catch (err) {
                this.log.error("❌ Erreur Dehumidifier Active onSet:", err);
            }
        });
        // État cible du déshumidificateur
        this.dehumidifierService
            .getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
            .onGet(() => Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
            .onSet((_value) => { });
        // État actuel du déshumidificateur
        this.dehumidifierService
            .getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return status.power && status.mode === "dry"
                    ? Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
                    : Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
            }
            catch (err) {
                this.log.error("❌ Erreur CurrentHumidifierDehumidifierState onGet:", err);
                return Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
            }
        });
        // Vitesse du déshumidificateur
        this.dehumidifierService
            .getCharacteristic(Characteristic.RotationSpeed)
            .setProps({ minValue: 0, maxValue: 100, minStep: 33 })
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                if (!status.power || status.mode !== "dry")
                    return 0;
                switch (status.speed) {
                    case "low":
                        return 33;
                    case "mid":
                        return 66;
                    case "high":
                        return 100;
                    default:
                        return 66;
                }
            }
            catch (err) {
                this.log.error("❌ Erreur Dehumidifier RotationSpeed onGet:", err);
                return 0;
            }
        })
            .onSet(async (value) => {
            try {
                if (Number(value) > 0) {
                    let speed = "mid";
                    const num = Number(value);
                    if (num >= 84)
                        speed = "high";
                    else if (num >= 50)
                        speed = "mid";
                    else
                        speed = "low";
                    await this.setStatus("speed", speed);
                }
            }
            catch (err) {
                this.log.error("❌ Erreur Dehumidifier RotationSpeed onSet:", err);
            }
        });
    }
    initSleepModeCharacteristics() {
        const { Characteristic } = this.hap;
        // Mode sommeil On/Off
        this.sleepModeService
            .getCharacteristic(Characteristic.On)
            .onGet(async () => {
            try {
                const status = await this.getStatus();
                return Boolean(status.sleep);
            }
            catch (err) {
                this.log.error("❌ Erreur Sleep Mode onGet:", err);
                return false;
            }
        })
            .onSet(async (value) => {
            try {
                await this.setStatus("sleep", Boolean(value));
            }
            catch (err) {
                this.log.error("❌ Erreur Sleep Mode onSet:", err);
            }
        });
    }
    getServices() {
        return [
            this.infoService,
            this.heaterCoolerService,
            this.fanService,
            this.dehumidifierService,
            this.sleepModeService,
        ];
    }
}
exports.KlarsteinACAccessory = KlarsteinACAccessory;
