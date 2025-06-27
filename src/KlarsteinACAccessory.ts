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

  private service: Service;
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

    this.service = new this.hap.Service.HeaterCooler(this.name);
    this.infoService = new this.hap.Service.AccessoryInformation()
      .setCharacteristic(this.hap.Characteristic.Manufacturer, "Klarstein")
      .setCharacteristic(this.hap.Characteristic.Model, "Tuya AC")
      .setCharacteristic(this.hap.Characteristic.SerialNumber, this.deviceId);

    this.initCharacteristics();
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
      const res = await axios.get(`${this.apiBase}${url}`, {
        headers: {
          client_id: this.clientId,
          access_token: this.accessToken,
          sign: sign,
          t: t,
          sign_method: "HMAC-SHA256",
          nonce: nonce,
        },
      });

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
        `${this.apiBase}${url}`,
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

  private initCharacteristics(): void {
    const { Characteristic } = this.hap;

    this.service
      .getCharacteristic(Characteristic.Active)
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          return status.power
            ? Characteristic.Active.ACTIVE
            : Characteristic.Active.INACTIVE;
        } catch (err) {
          this.log.error("❌ Erreur Active onGet:", err);
          return Characteristic.Active.INACTIVE;
        }
      })
      .onSet(async (value) => {
        try {
          const on = value === Characteristic.Active.ACTIVE;
          await this.setStatus("power", on);
        } catch (err) {
          this.log.error("❌ Erreur Active onSet:", err);
        }
      });

    this.service
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
        } catch (err) {
          this.log.error("❌ Erreur CoolingThresholdTemperature onSet:", err);
        }
      });

    this.service
      .getCharacteristic(Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 50 })
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          switch (status.speed) {
            case "low":
              return 0;
            case "mid":
              return 50;
            case "high":
              return 100;
            default:
              return 50;
          }
        } catch (err) {
          this.log.error("❌ Erreur RotationSpeed onGet:", err);
          return 50;
        }
      })
      .onSet(async (value) => {
        try {
          let speed = "mid";
          const num = Number(value);
          if (num >= 75) speed = "high";
          else if (num >= 25) speed = "mid";
          else speed = "low";
          await this.setStatus("speed", speed);
        } catch (err) {
          this.log.error("❌ Erreur RotationSpeed onSet:", err);
        }
      });

    this.service
      .getCharacteristic(Characteristic.TargetHeaterCoolerState)
      .onGet(() => Characteristic.TargetHeaterCoolerState.COOL)
      .onSet((_value) => {});

    this.service
      .getCharacteristic(Characteristic.CurrentHeaterCoolerState)
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          return status.power
            ? Characteristic.CurrentHeaterCoolerState.COOLING
            : Characteristic.CurrentHeaterCoolerState.INACTIVE;
        } catch (err) {
          this.log.error("❌ Erreur CurrentHeaterCoolerState onGet:", err);
          return Characteristic.CurrentHeaterCoolerState.INACTIVE;
        }
      });

    this.service
      .getCharacteristic(Characteristic.CurrentTemperature)
      .onGet(async () => {
        try {
          const status = await this.getStatus();
          return status.temp_c_set || 22;
        } catch (err) {
          this.log.error("❌ Erreur CurrentTemperature onGet:", err);
          return 22;
        }
      });
  }

  getServices(): Service[] {
    return [this.infoService, this.service];
  }
}
