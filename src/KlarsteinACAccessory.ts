import axios from "axios";
import crypto from "crypto";
import {
  AccessoryPlugin,
  API,
  Logging,
  AccessoryConfig,
  Service,
  HAP,
} from "homebridge";

export class KlarsteinACAccessory implements AccessoryPlugin {
  private readonly log: Logging;
  private readonly name: string;
  private readonly hap: HAP;
  private readonly deviceId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;

  // Services multiples pour les différents modes
  private heaterCoolerService: Service;
  private fanService: Service;
  private dehumidifierService: Service;
  private sleepModeService: Service;
  private infoService: Service;
  private accessToken = "";
  private apiBase = "https://openapi.tuyaeu.com/v1.0";

  constructor(log: Logging, config: AccessoryConfig, api: API) {
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
    this.heaterCoolerService = new this.hap.Service.HeaterCooler(
      `${this.name} Climatiseur`
    );

    // Service ventilateur (mode fan)
    this.fanService = new this.hap.Service.Fan(`${this.name} Ventilateur`);

    // Service déshumidificateur (mode dry)
    this.dehumidifierService = new this.hap.Service.HumidifierDehumidifier(
      `${this.name} Déshumidificateur`
    );

    // Service mode sommeil
    this.sleepModeService = new this.hap.Service.Switch(
      `${this.name} Mode Sommeil`
    );

    this.initAllCharacteristics();
  }

  private generateUUID(): string {
    return crypto.randomUUID();
  }

  private createSignature(
    httpMethod: string,
    url: string,
    body: string = ""
  ): { sign: string; t: string; nonce: string } {
    const t = Date.now().toString();
    const nonce = this.generateUUID().replace(/-/g, "");
    const contentSHA256 = crypto
      .createHash("sha256")
      .update(body)
      .digest("hex");
    const optionalSignatureKey = "";

    const stringToSign =
      httpMethod +
      "\n" +
      contentSHA256 +
      "\n" +
      optionalSignatureKey +
      "\n" +
      url;

    const str = this.clientId + t + nonce + stringToSign;

    const sign = crypto
      .createHmac("sha256", this.clientSecret)
      .update(str)
      .digest("hex")
      .toUpperCase();

    return { sign, t, nonce };
  }

  private createBusinessSignature(
    httpMethod: string,
    url: string,
    body: string = ""
  ): { sign: string; t: string; nonce: string } {
    const t = Date.now().toString();
    const nonce = this.generateUUID().replace(/-/g, "");

    const contentSHA256 = crypto
      .createHash("sha256")
      .update(body)
      .digest("hex");
    const optionalSignatureKey = "";

    const stringToSign =
      httpMethod +
      "\n" +
      contentSHA256 +
      "\n" +
      optionalSignatureKey +
      "\n" +
      url;

    const str = this.clientId + this.accessToken + t + nonce + stringToSign;

    const sign = crypto
      .createHmac("sha256", this.clientSecret)
      .update(str)
      .digest("hex")
      .toUpperCase();

    return { sign, t, nonce };
  }

  private async getAccessToken(): Promise<void> {
    const url = "/v1.0/token?grant_type=1";
    const { sign, t, nonce } = this.createSignature("GET", url);

    try {
      const response = await axios.get(`${this.apiBase}/token?grant_type=1`, {
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
    } catch (err: any) {
      this.log.error(
        "❌ Token-Fehler:",
        err?.response?.data || err?.message || err
      );
    }
  }

  private async getStatus(): Promise<Record<string, any>> {
    await this.getAccessToken();

    const url = `/v1.0/devices/${this.deviceId}/status`;
    const { sign, t, nonce } = this.createBusinessSignature("GET", url);

    try {
      const res = await axios.get(
        `${this.apiBase}/devices/${this.deviceId}/status`,
        {
          headers: {
            client_id: this.clientId,
            access_token: this.accessToken,
            sign: sign,
            t: t,
            sign_method: "HMAC-SHA256",
            nonce: nonce,
          },
        }
      );
      const status: Record<string, any> = {};
      for (const dp of res.data.result) {
        status[dp.code] = dp.value;
      }
      return status;
    } catch (err: any) {
      this.log.error(
        "❌ Erreur getStatus:",
        err?.response?.data || err?.message || err
      );
      return {};
    }
  }

  private async setStatus(code: string, value: any): Promise<void> {
    await this.getAccessToken();

    const url = `/v1.0/devices/${this.deviceId}/commands`;
    const body = JSON.stringify({ commands: [{ code, value }] });
    const { sign, t, nonce } = this.createBusinessSignature("POST", url, body);

    try {
      await axios.post(
        `${this.apiBase}/devices/${this.deviceId}/commands`,
        {
          commands: [{ code, value }],
        },
        {
          headers: {
            client_id: this.clientId,
            access_token: this.accessToken,
            sign: sign,
            t: t,
            sign_method: "HMAC-SHA256",
            nonce: nonce,
            "Content-Type": "application/json",
          },
        }
      );

      this.log.info(`🔁 Set ${code} = ${value}`);
    } catch (err: any) {
      this.log.error(
        "❌ Erreur setStatus:",
        err?.response?.data || err?.message || err
      );
    }
  }

  private async getCurrentMode(): Promise<string> {
    try {
      const status = await this.getStatus();
      return status.mode || "cool";
    } catch (err) {
      this.log.error("❌ Erreur getCurrentMode:", err);
      return "cool";
    }
  }

  private async setMode(mode: string): Promise<void> {
    try {
      await this.setStatus("mode", mode);
      this.log.info(`🔄 Mode changé vers: ${mode}`);
    } catch (err) {
      this.log.error("❌ Erreur setMode:", err);
    }
  }

  private initAllCharacteristics(): void {
    this.initHeaterCoolerCharacteristics();
    this.initFanCharacteristics();
    this.initDehumidifierCharacteristics();
    this.initSleepModeCharacteristics();

    // Synchroniser les températures au démarrage
    this.syncTemperatures();
  }

  private async syncTemperatures(): Promise<void> {
    try {
      const status = await this.getStatus();
      const temp = status.temp_c_set || 22;

      // Forcer la synchronisation des deux seuils de température
      this.heaterCoolerService.updateCharacteristic(
        this.hap.Characteristic.CoolingThresholdTemperature,
        temp
      );
      this.heaterCoolerService.updateCharacteristic(
        this.hap.Characteristic.HeatingThresholdTemperature,
        temp
      );

      this.log.info(`🔄 Températures synchronisées: ${temp}°C`);
    } catch (err) {
      this.log.error("❌ Erreur syncTemperatures:", err);
    }
  }

  private initHeaterCoolerCharacteristics(): void {
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
        } catch (err) {
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
          } else {
            await this.setStatus("power", false);
          }
        } catch (err) {
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
        } catch (err) {
          this.log.error("❌ Erreur CoolingThresholdTemperature onGet:", err);
          return 22;
        }
      })
      .onSet(async (value) => {
        try {
          await this.setStatus("temp_c_set", value);
          // Synchroniser IMMÉDIATEMENT avec la température de chauffage
          this.heaterCoolerService.updateCharacteristic(
            Characteristic.HeatingThresholdTemperature,
            value
          );
          this.log.info(`🌡️ Température unique définie: ${value}°C`);
        } catch (err) {
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
        } catch (err) {
          this.log.error("❌ Erreur TargetHeaterCoolerState onGet:", err);
          return Characteristic.TargetHeaterCoolerState.COOL;
        }
      })
      .onSet(async (value) => {
        try {
          const mode =
            value === Characteristic.TargetHeaterCoolerState.AUTO
              ? "auto"
              : "cool";
          await this.setMode(mode);
        } catch (err) {
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
          if (
            !status.power ||
            (currentMode !== "cool" && currentMode !== "auto")
          ) {
            return Characteristic.CurrentHeaterCoolerState.INACTIVE;
          }
          return Characteristic.CurrentHeaterCoolerState.COOLING;
        } catch (err) {
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
          return status.temp_c_disp || 22; // Utilisé comme température actuelle
        } catch (err) {
          this.log.error("❌ Erreur CurrentTemperature onGet:", err);
          return 22;
        }
      });

    // Température de chauffage (forcée identique à la température de refroidissement)
    // Cela simule une consigne unique même en mode AUTO
    this.heaterCoolerService
      .getCharacteristic(Characteristic.HeatingThresholdTemperature)
      .setProps({
        minValue: 18,
        maxValue: 32,
        minStep: 1,
        // Masquer cette caractéristique car elle sera automatiquement synchronisée
      })
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          return status.temp_c_set || 22;
        } catch (err) {
          this.log.error("❌ Erreur HeatingThresholdTemperature onGet:", err);
          return 22;
        }
      })
      .onSet(async (value) => {
        try {
          await this.setStatus("temp_c_set", value);
          // Synchroniser IMMÉDIATEMENT avec la température de refroidissement
          this.heaterCoolerService.updateCharacteristic(
            Characteristic.CoolingThresholdTemperature,
            value
          );
          this.log.info(`🌡️ Température unique définie: ${value}°C`);
        } catch (err) {
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
        } catch (err) {
          this.log.error("❌ Erreur HeaterCooler RotationSpeed onGet:", err);
          return 66;
        }
      })
      .onSet(async (value) => {
        try {
          let speed = "mid";
          const num = Number(value);
          if (num >= 84) speed = "high";
          else if (num >= 50) speed = "mid";
          else speed = "low";
          await this.setStatus("speed", speed);
        } catch (err) {
          this.log.error("❌ Erreur HeaterCooler RotationSpeed onSet:", err);
        }
      });
  }

  private initFanCharacteristics(): void {
    const { Characteristic } = this.hap;

    // Ventilateur On/Off
    this.fanService
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          return status.power && status.mode === "fan";
        } catch (err) {
          this.log.error("❌ Erreur Fan On onGet:", err);
          return false;
        }
      })
      .onSet(async (value) => {
        try {
          if (value) {
            await this.setStatus("power", true);
            await this.setMode("fan");
          } else {
            await this.setStatus("power", false);
          }
        } catch (err) {
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
          if (!status.power || status.mode !== "fan") return 0;
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
        } catch (err) {
          this.log.error("❌ Erreur Fan RotationSpeed onGet:", err);
          return 0;
        }
      })
      .onSet(async (value) => {
        try {
          if (Number(value) > 0) {
            let speed = "mid";
            const num = Number(value);
            if (num >= 84) speed = "high";
            else if (num >= 50) speed = "mid";
            else speed = "low";
            await this.setStatus("speed", speed);
          }
        } catch (err) {
          this.log.error("❌ Erreur Fan RotationSpeed onSet:", err);
        }
      });
  }

  private initDehumidifierCharacteristics(): void {
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
        } catch (err) {
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
          } else {
            await this.setStatus("power", false);
          }
        } catch (err) {
          this.log.error("❌ Erreur Dehumidifier Active onSet:", err);
        }
      });

    // État cible du déshumidificateur
    this.dehumidifierService
      .getCharacteristic(Characteristic.TargetHumidifierDehumidifierState)
      .onGet(
        () => Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER
      )
      .onSet((_value) => {});

    // État actuel du déshumidificateur
    this.dehumidifierService
      .getCharacteristic(Characteristic.CurrentHumidifierDehumidifierState)
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          return status.power && status.mode === "dry"
            ? Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING
            : Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
        } catch (err) {
          this.log.error(
            "❌ Erreur CurrentHumidifierDehumidifierState onGet:",
            err
          );
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
          if (!status.power || status.mode !== "dry") return 0;
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
        } catch (err) {
          this.log.error("❌ Erreur Dehumidifier RotationSpeed onGet:", err);
          return 0;
        }
      })
      .onSet(async (value) => {
        try {
          if (Number(value) > 0) {
            let speed = "mid";
            const num = Number(value);
            if (num >= 84) speed = "high";
            else if (num >= 50) speed = "mid";
            else speed = "low";
            await this.setStatus("speed", speed);
          }
        } catch (err) {
          this.log.error("❌ Erreur Dehumidifier RotationSpeed onSet:", err);
        }
      });
  }

  private initSleepModeCharacteristics(): void {
    const { Characteristic } = this.hap;

    // Mode sommeil On/Off
    this.sleepModeService
      .getCharacteristic(Characteristic.On)
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          return Boolean(status.sleep);
        } catch (err) {
          this.log.error("❌ Erreur Sleep Mode onGet:", err);
          return false;
        }
      })
      .onSet(async (value) => {
        try {
          await this.setStatus("sleep", Boolean(value));
        } catch (err) {
          this.log.error("❌ Erreur Sleep Mode onSet:", err);
        }
      });
  }

  getServices(): Service[] {
    return [
      this.infoService,
      this.heaterCoolerService,
      this.fanService,
      this.dehumidifierService,
      this.sleepModeService,
    ];
  }
}
