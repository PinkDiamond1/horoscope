import { IAccountUnbonds } from "entities/account-unbonds.entity";
import { model, models, Types, Schema } from "mongoose";
import { definitionType } from "types";
import { customInfoModel } from "./custom-info.model";

const definition: definitionType<IAccountUnbonds> = (collection?: string) => ({
	_id: Types.ObjectId,
	address: String,
	unbonding_responses: [
		{
			delegator_address: String,
			validator_address: String,
			entries: [
				{
					creation_height: String,
					completion_time: String,
					initial_balance: String,
					balance: String,
				},
			],
		},
	],
	custom_info: customInfoModel,
});

export const accountUnbondsMongoModel = (collection: string): unknown => {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore
	const schema = new Schema<IAccountUnbonds>(definition(collection), {
		autoIndex: true,
		collection: collection,
	});
	return models[collection] || model(collection, schema);
};