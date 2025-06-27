import { API } from 'homebridge';
import { KlarsteinACAccessory } from './KlarsteinACAccessory';

export = (api: API) => {
  api.registerAccessory('KlarsteinAC', KlarsteinACAccessory);
};
