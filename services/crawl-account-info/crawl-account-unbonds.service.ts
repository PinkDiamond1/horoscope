import CallApiMixin from '../../mixins/callApi/call-api.mixin';
import { dbAccountUnbondsMixin } from '../../mixins/dbMixinMongoose';
import { Job } from 'bull';
import { Config } from '../../common';
import { CONST_CHAR, DELAY_JOB_TYPE, LIST_NETWORK, MSG_TYPE, URL_TYPE_CONSTANTS } from '../../common/constant';
import { JsonConvert } from 'json2typescript';
import { Context, Service, ServiceBroker } from 'moleculer';
import { AccountUnbondsEntity, UnbondingResponse } from '../../entities';
import { Utils } from '../../utils/utils';
import { CrawlAccountInfoParams } from '../../types';
import { DelayJobEntity } from 'entities/delay-job.entity';
const QueueService = require('moleculer-bull');
const Bull = require('bull');
const mongo = require('mongodb');

export default class CrawlAccountUnbondsService extends Service {
	private callApiMixin = new CallApiMixin().start();
	private dbAccountUnbondsMixin = dbAccountUnbondsMixin;

	public constructor(public broker: ServiceBroker) {
		super(broker);
		this.parseServiceSchema({
			name: 'crawlAccountUnbonds',
			version: 1,
			mixins: [
				QueueService(
					`redis://${Config.REDIS_USERNAME}:${Config.REDIS_PASSWORD}@${Config.REDIS_HOST}:${Config.REDIS_PORT}/${Config.REDIS_DB_NUMBER}`,
					{
						prefix: 'crawl.account-unbonds',
					},
				),
				// this.redisMixin,
				this.dbAccountUnbondsMixin,
				this.callApiMixin,
			],
			queues: {
				'crawl.account-unbonds': {
					concurrency: parseInt(Config.CONCURRENCY_ACCOUNT_UNBONDS, 10),
					process(job: Job) {
						job.progress(10);
						// @ts-ignore
						this.handleJob(job.data.listAddresses, job.data.chainId);
						job.progress(100);
						return true;
					},
				},
			},
			events: {
				'account-info.upsert-each': {
					handler: (ctx: Context<CrawlAccountInfoParams>) => {
						this.logger.debug(`Crawl account unbonds`);
						this.createJob(
							'crawl.account-unbonds',
							{
								listAddresses: ctx.params.listAddresses,
								chainId: ctx.params.chainId,
							},
							{
								removeOnComplete: true,
							},
						);
						return;
					},
				},
			},
		});
	}

	async handleJob(listAddresses: string[], chainId: string) {
		let client = await this.connectToDB();
		const db = client.db('aura_indexer_dev');
		let [accountUnbonds, delayJob] = await Promise.all([
			db.collection("account_unbonds"),
			db.collection("delay_job"),
		]);

		let listAccounts: AccountUnbondsEntity[] = [],
			listUpdateQueries: any[] = [],
			listDelayJobs: DelayJobEntity[] = [];
		if (listAddresses.length > 0) {
			listAddresses.map(async (address) => {
				let listUnbonds: UnbondingResponse[] = [];

				const param =
					Config.GET_PARAMS_DELEGATOR +
					`/${address}/unbonding_delegations?pagination.limit=100`;
				const url = Utils.getUrlByChainIdAndType(chainId, URL_TYPE_CONSTANTS.LCD);

				let accountInfo: AccountUnbondsEntity = await this.adapter.findOne({
					address,
					'custom_info.chain_id': chainId,
				});
				if (!accountInfo) {
					accountInfo = {} as AccountUnbondsEntity;
					accountInfo.address = address;
				}

				let urlToCall = param;
				let done = false;
				let resultCallApi;
				while (!done) {
					resultCallApi = await this.callApiFromDomain(url, urlToCall);

					listUnbonds.push(...resultCallApi.unbonding_responses);
					if (resultCallApi.pagination.next_key === null) {
						done = true;
					} else {
						urlToCall = `${param}&pagination.key=${encodeURIComponent(
							resultCallApi.pagination.next_key,
						)}`;
					}
				}

				if (listUnbonds) {
					accountInfo.unbonding_responses = listUnbonds;
					listUnbonds.map((unbond: UnbondingResponse) => {
						// let expireTime = new Date(unbond.entries[0].completion_time.toString());
						// let delay = expireTime.getTime() - new Date().getTime();
						// const apiKeyQueue = new Bull(
						// 	'handle.address',
						// 	{
						// 		redis: {
						// 			host: Config.REDIS_HOST,
						// 			port: Config.REDIS_PORT,
						// 			username: Config.REDIS_USERNAME,
						// 			password: Config.REDIS_PASSWORD,
						// 			db: Config.REDIS_DB_NUMBER,
						// 		},
						// 		prefix: 'handle.address',
						// 		defaultJobOptions: {
						// 			jobId: `${address}_${chainId}_${unbond.entries[0].completion_time}`,
						// 			removeOnComplete: true,
						// 			delay,
						// 		}
						// 	}
						// );
						// apiKeyQueue.add({
						// 	listAddresses: [address],
						// 	chainId
						// });
						let newDelayJob = {} as DelayJobEntity;
						newDelayJob.address = address;
						newDelayJob.type = DELAY_JOB_TYPE.UNBOND;
						newDelayJob.expire_time = unbond.entries[0].completion_time.toString();
						listDelayJobs.push(newDelayJob);
					});
				}

				listAccounts.push(accountInfo);
			});
		}
		try {
			listAccounts.forEach((element) => {
				if (element._id)
					listUpdateQueries.push(this.adapter.updateById(element._id, element));
				else {
					const chain = LIST_NETWORK.find((x) => x.chainId === chainId);
					const item: AccountUnbondsEntity = new JsonConvert().deserializeObject(
						element,
						AccountUnbondsEntity,
					);
					item.custom_info = {
						chain_id: chainId,
						chain_name: chain ? chain.chainName : '',
					};
					listUpdateQueries.push(this.adapter.insert(item));
				}
			});
			listDelayJobs.map((element) => {
				const chain = LIST_NETWORK.find((x) => x.chainId === chainId);
				const item: DelayJobEntity = new JsonConvert().deserializeObject(
					element,
					DelayJobEntity,
				);
				item.custom_info = {
					chain_id: chainId,
					chain_name: chain ? chain.chainName : '',
				};
				listUpdateQueries.push(delayJob.insertOne(item));
			});
			await Promise.all(listUpdateQueries);
		} catch (error) {
			this.logger.error(error);
		}
	}

	async connectToDB() {
		const DB_URL = `mongodb://${Config.DB_GENERIC_USER}:${encodeURIComponent(Config.DB_GENERIC_PASSWORD)}@${Config.DB_GENERIC_HOST}:${Config.DB_GENERIC_PORT}`;

		let cacheClient = await mongo.MongoClient.connect(
			DB_URL,
		);
		return cacheClient;
	}

	async _start() {
		this.getQueue('crawl.account-unbonds').on('completed', (job: Job) => {
			this.logger.info(`Job #${job.id} completed!. Result:`, job.returnvalue);
		});
		this.getQueue('crawl.account-unbonds').on('failed', (job: Job) => {
			this.logger.error(`Job #${job.id} failed!. Result:`, job.stacktrace);
		});
		this.getQueue('crawl.account-unbonds').on('progress', (job: Job) => {
			this.logger.info(`Job #${job.id} progress is ${job.progress()}%`);
		});
		return super._start();
	}
}
