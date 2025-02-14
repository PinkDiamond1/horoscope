import { JsonProperty } from 'json2typescript';
import { Types } from 'mongoose';
import { Config } from '../common';

export interface ICW721Asset {
	_id: Types.ObjectId | string | null;
	asset_id: String;
	code_id: String;
	asset_info: Object;
	contract_address: String;
	token_id: String;
	owner: String;
	media_link: String;
	history: Object[];
	is_burned: Boolean;
	metadata: any;
}

export class CW721AssetEntity implements ICW721Asset {
	@JsonProperty('_id', String, true)
	_id = Config.DB_CW721_ASSET.dialect === 'local' ? Types.ObjectId() : null;

	@JsonProperty('asset_id', String)
	asset_id: String = '';
	@JsonProperty('code_id', String)
	code_id: String = '';
	@JsonProperty('asset_info', Object)
	asset_info: Object = {};
	@JsonProperty('contract_address', String)
	contract_address: String = '';
	@JsonProperty('token_id', String)
	token_id: String = '';
	@JsonProperty('owner', String)
	owner: String = '';
	@JsonProperty('media_link', String)
	media_link: String = '';
	@JsonProperty('history', Object)
	history: Object[] = [];
	@JsonProperty('asset_id', String)
	is_burned: Boolean = false;
	@JsonProperty('asset_id', String)
	metadata: any = {};

	custom_info: Object = {};
	image: Object = {};
	animation: Object = {};
}
