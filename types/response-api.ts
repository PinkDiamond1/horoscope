import { ISigningInfo } from 'model/signing-info.model';
import {
	BlockEntity,
	CommunityPoolEntity,
	IBlock,
	ICommunityPool,
	IPool,
	IProposal,
	IValidator,
	PoolEntity,
	ProposalEntity,
	SigningInfoEntity,
	ValidatorEntity,
} from '../entities';

export interface IPagingationResponseFromLCD {
	next_key: String | null;
	total: String;
}

export interface IProposalResponseFromLCD {
	proposals: IProposal[];
	pagination: IPagingationResponseFromLCD;
}

export interface IValidatorResponseFromLCD {
	validators: IValidator[];
	pagination: IPagingationResponseFromLCD;
}

export interface IPoolResponseFromLCD {
	pool: IPool;
}

export interface ICommunityPoolResponseFromLCD {
	pool: ICommunityPool[];
}
export interface ISigningInfoResponseFromLCD {
	info: ISigningInfo[];
}
export interface ISigningInfoEntityResponseFromLCD {
	val_signing_info: ISigningInfo[];
}
export interface MintInflationResponseFromLCD {
	inflation: String;
}

export interface ResponseFromRPC {
	jsonrpc: String;
	id: String;
	result: any;
}

export interface BlockResponseFromLCD {
	blocks: IBlock[];
}

export type ResponseDto = {
	code: number | string;
	message: string;
	data: any;
};
