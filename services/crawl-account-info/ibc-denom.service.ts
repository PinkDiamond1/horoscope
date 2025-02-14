/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';
import { Put, Method, Service, Get, Action } from '@ourparentcenter/moleculer-decorators-extended';
import { MoleculerDBService, QueryIBCDenomParams } from '../../types';
import { IBCDenomEntity, IIBCDenom } from '../../entities';
import { dbIBCDenomMixin } from '../../mixins/dbMixinMongoose';
import { Context } from 'moleculer';
import { JsonConvert } from 'json2typescript';

/**
 * @typedef {import('moleculer').Context} Context Moleculer's Context
 */
 @Service({
	name: 'ibc-denom',
	version: 1,
	/**
	 * Mixins
	 */
	mixins: [dbIBCDenomMixin],
	/**
	 * Settings
	 */
})
export default class IBCDenomService extends MoleculerDBService<
    {
        rest: 'v1/ibc-denom';
    },
    IIBCDenom
> {
    @Action({
		name: 'getByHash',
		cache: {
			ttl: 10,
		},
	})
    async getByHash(ctx: Context<QueryIBCDenomParams>) {
        let result = await this.adapter.findOne({ hash: ctx.params.hash });
        return result;
    }

    @Action({
		name: 'addNewDenom',
		cache: {
			ttl: 10,
		},
	})
    async addNewDenom(ctx: Context<QueryIBCDenomParams>) {
        let ibc_denom = {} as IBCDenomEntity;
        const item: IBCDenomEntity = new JsonConvert().deserializeObject(
            ibc_denom,
            IBCDenomEntity,
        );
        item.denom = ctx.params.denom;
        item.hash = ctx.params.hash;
        let result = await this.adapter.insert(item);
        return result;
    }
}