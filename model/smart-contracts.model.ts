import { model, models, Schema, Types } from 'mongoose';
import { definitionType, ObjectIdNull } from '../types';
import { customInfoModel } from './custom-info.model';

export interface ISmartContracts {
    _id: ObjectIdNull;
    height: Number;
    code_id: Number;
    contract_name: String;
    contract_address: String;
    creator_address: String;
    contract_hash: String;
    tx_hash: String;
}

const definition: definitionType<ISmartContracts> = (collection?: string) => ({
	_id: Types.ObjectId,
	height: {
        type: Number,
        index: true
    },
    code_id: Number,
    contract_name: String,
    contract_address: {
        type: String,
        index: true
    },
    creator_address: String,
    contract_hash: String,
    tx_hash: String,
	custom_info: customInfoModel,
})


export const smartContractsMongoModel = (collection: string): unknown => {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	const schema = new Schema<ISmartContracts>(definition(collection), {
		autoIndex: true,
		collection: collection,
	});
    // @ts-ignore
	schema.index({ 'custom_info.chain_id': 1, 'code_id': 1, 'contract_address': 1 }, { unique: true, name: 'unique_contract' });
	return models[collection] || model(collection, schema);
};