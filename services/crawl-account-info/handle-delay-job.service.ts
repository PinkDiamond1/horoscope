/* eslint-disable @typescript-eslint/explicit-member-accessibility */
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
'use strict';

import { Job } from 'bull';
import { Config } from '../../common';
import { DELAY_JOB_TYPE } from '../../common/constant';
import { RedelegateEntry, DelayJobEntity, RedelegationEntry } from '../../entities';
import { Service, ServiceBroker } from 'moleculer';
import { Coin } from 'entities/coin.entity';
import { QueueConfig } from '../../config/queue';
import { dbAccountInfoMixin } from '../../mixins/dbMixinMongoose';
const QueueService = require('moleculer-bull');

export default class HandleDelayJobService extends Service {
	private dbAccountInfoMixin = dbAccountInfoMixin;

	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'handleDelayJob',
			version: 1,
			mixins: [QueueService(QueueConfig.redis, QueueConfig.opts), this.dbAccountInfoMixin],
			queues: {
				'handle.delay-job': {
					concurrency: parseInt(Config.CONCURRENCY_HANDLE_DELAY_JOB, 10),
					async process(job: Job) {
						job.progress(10);
						// @ts-ignore
						await this.handleJob();
						job.progress(100);
						return true;
					},
				},
			},
		});
	}

	async handleJob() {
		let listUpdateQueries: any[] = [];

		let currentJobs: DelayJobEntity[];
		try {
			currentJobs = await this.broker.call('v1.delay-job.findPendingJobs', {
				chain_id: Config.CHAIN_ID,
			});
		} catch (error) {
			this.logger.error(error);
			throw error;
		}
		currentJobs.map(async (job: any) => {
			if (job.expire_time <= new Date().getTime()) {
				switch (job.type) {
					case DELAY_JOB_TYPE.REDELEGATE:
						try {
							let updateRedelegates = await this.adapter.findOne({
								address: job.content.address,
								'custom_info.chain_id': Config.CHAIN_ID,
							});
							let oldRedelegates =
									updateRedelegates.redelegation_responses[0].entries,
								removeRedelegate = oldRedelegates.find(
									(x: RedelegateEntry) =>
										new Date(
											x.redelegation_entry.completion_time!,
										).getTime() === new Date(job.expire_time).getTime(),
								);
							oldRedelegates.splice(oldRedelegates.indexOf(removeRedelegate), 1);
							let newRedelegates = updateRedelegates.redelegation_responses;
							if (oldRedelegates.length === 0) newRedelegates = [];
							else newRedelegates[0].entries = oldRedelegates;
							listUpdateQueries.push(
								...[
									this.adapter.updateById(
										{
											_id: updateRedelegates._id,
										},
										{
											$set: {
												account_redelegations: newRedelegates,
											},
										},
									),
									this.broker.call('v1.delay-job.deleteFinishedJob', {
										_id: job._id,
									}),
								],
							);
						} catch (error) {
							this.logger.error(error);
							throw error;
						}
						break;
					case DELAY_JOB_TYPE.UNBOND:
						try {
							let updateInfo = await this.adapter.findOne({
								address: job.content.address,
								'custom_info.chain_id': Config.CHAIN_ID,
							});
							let newBalances = updateInfo.account_balances,
								newSpendableBalances = updateInfo.account_spendable_balances,
								oldUnbonds = updateInfo.account_unbonding[0].entries,
								removeUnbond = oldUnbonds.find(
									(x: RedelegationEntry) =>
										new Date(x.completion_time!).getTime() ===
										new Date(job.expire_time).getTime(),
								);
							newBalances.find(
								(balance: any) => balance.denom === Config.NETWORK_DENOM,
							).amount = (
								parseInt(newBalances[0].amount, 10) +
								parseInt(removeUnbond.balance, 10)
							).toString();
							newSpendableBalances.find(
								(balance: any) => balance.denom === Config.NETWORK_DENOM,
							).amount = (
								parseInt(newSpendableBalances[0].amount, 10) +
								parseInt(removeUnbond.balance, 10)
							).toString();
							oldUnbonds.splice(oldUnbonds.indexOf(removeUnbond), 1);
							let newUnbonds = updateInfo.account_unbonding;
							if (oldUnbonds.length === 0) newUnbonds = [];
							else newUnbonds[0].entries = oldUnbonds;
							listUpdateQueries.push(
								...[
									this.adapter.updateById(
										{
											_id: updateInfo._id,
										},
										{
											$set: {
												account_balances: newBalances,
												account_spendable_balances: newSpendableBalances,
												account_unbonding: newUnbonds,
											},
										},
									),
									this.broker.call('v1.delay-job.deleteFinishedJob', {
										_id: job._id,
									}),
								],
							);
						} catch (error) {
							this.logger.error(error);
							throw error;
						}
						break;
					case DELAY_JOB_TYPE.DELAYED_VESTING:
						try {
							let updateInfo = await this.adapter.findOne({
								address: job.content.address,
								'custom_info.chain_id': Config.CHAIN_ID,
							});
							let newSpendableBalances = updateInfo.account_spendable_balances;
							let oldAmount = newSpendableBalances.find(
								(x: Coin) =>
									x.denom ===
									updateInfo.account_auth.account.base_vesting_account
										.original_vesting[0].denom,
							).amount;
							let vestingInfo =
								updateInfo.account_auth.account.base_vesting_account
									.original_vesting;
							newSpendableBalances.find(
								(x: Coin) => x.denom === vestingInfo[0].denom,
							).amount = (
								parseInt(oldAmount, 10) + parseInt(vestingInfo[0].amount, 10)
							).toString();
							listUpdateQueries.push(
								this.adapter.updateById(
									{
										_id: updateInfo._id,
									},
									{
										$set: {
											account_spendable_balances: newSpendableBalances,
										},
									},
								),
								this.broker.call('v1.delay-job.deleteFinishedJob', {
									_id: job._id,
								}),
							);
						} catch (error) {
							this.logger.error(error);
							throw error;
						}
						break;
					case DELAY_JOB_TYPE.PERIODIC_VESTING:
						try {
							let updateInfo = await this.adapter.findOne({
								address: job.content.address,
								'custom_info.chain_id': Config.CHAIN_ID,
							});
							let newSpendableBalances = updateInfo.account_spendable_balances;
							let oldAmount = newSpendableBalances.find(
								(x: Coin) =>
									x.denom ===
									updateInfo.account_auth.account.original_vesting[0].denom,
							).amount;
							let vestingInfo =
								updateInfo.account_auth.account.base_vesting_account
									.original_vesting;
							newSpendableBalances.find(
								(x: Coin) => x.denom === vestingInfo[0].denom,
							).amount = (
								parseInt(oldAmount, 10) +
								parseInt(
									updateInfo.account_auth.account.vesting_periods[0].amount[0]
										.amount,
									10,
								)
							).toString();
							let newJobExpireTime = new Date(
								(job.expire_time.getTime() +
									parseInt(
										updateInfo.account_auth.account.vesting_periods[0].length,
										10,
									)) *
									1000,
							);
							if (
								newJobExpireTime.getTime() >=
								new Date(
									parseInt(
										updateInfo.account_auth.account.base_vesting_account
											.end_time,
										10,
									) * 1000,
								).getTime()
							)
								listUpdateQueries.push(
									this.broker.call('v1.delay-job.deleteFinishedJob', {
										_id: job._id,
									}),
								);
							else {
								listUpdateQueries.push(
									this.broker.call('v1.delay-job.updateJob', {
										_id: job._id,
										update: {
											$set: {
												expire_time: newJobExpireTime,
											},
										},
									}),
								);
							}
							listUpdateQueries.push(
								this.adapter.updateById(
									{
										_id: updateInfo._id,
									},
									{
										$set: {
											account_spendable_balances: newSpendableBalances,
										},
									},
								),
							);
						} catch (error) {
							this.logger.error(error);
							throw error;
						}
						break;
				}
				const result = await Promise.all(listUpdateQueries);
				this.logger.info(result);
			}
		});
	}

	async _start() {
		this.createJob(
			'handle.delay-job',
			{},
			{
				removeOnComplete: true,
				removeOnFail: {
					count: 3,
				},
				repeat: {
					every: parseInt(Config.MILISECOND_HANDLE_DELAY_JOB, 10),
				},
			},
		);

		this.getQueue('handle.delay-job').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!, result: ${job.returnvalue}`);
		});
		this.getQueue('handle.delay-job').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!, error: ${job.failedReason}`);
		});
		this.getQueue('handle.delay-job').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress: ${job.progress()}%`);
		});
		return super._start();
	}
}
