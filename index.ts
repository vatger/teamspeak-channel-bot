import {TeamSpeak, TeamSpeakChannel} from "ts3-nodejs-library";
import QueryProtocol = TeamSpeak.QueryProtocol;
import {chatChannelNames} from "./channelNames";
import dotenv from "dotenv"
import * as process from "process";
import {v4} from "uuid";

dotenv.config();

console.log("Starting Application...");

console.log(v4())

const nameMap = new Map<string, string[]>();
nameMap.set(process.env.CHAT_PARENT_ID!, chatChannelNames);

const teamspeak = new TeamSpeak({
    host: process.env.TS_HOST,
    protocol: QueryProtocol.RAW,
    serverport: Number(process.env.TS_SERVERPORT),
    queryport: Number(process.env.TS_QUERYPORT),
    username: process.env.TS_USERNAME,
    password: process.env.TS_PASSWORD,
    keepAlive: true
});

async function getSubChannels(parentID: string): Promise<TeamSpeakChannel[]> {
    let allChannels = await teamspeak.channelList();

    return allChannels.filter(c => {
        return c.pid == parentID
    });
}

async function getRandomChannelName(parentID: string): Promise<string> {
    const currentChannels = await getSubChannels(parentID);
    if (!nameMap.has(parentID)) {
        return v4();
    }

    for (const s of nameMap.get(parentID)!) {
        // Check if channel with this name exists
        if (currentChannels.find(c => c.name.indexOf(s) != -1) == null) {
            return s;
        }
    }

    // Generate UUID as fallback name, if all 36 names are used
    return v4();
}

function getEmptyChannels(subChannels: TeamSpeakChannel[]): TeamSpeakChannel[] {
    let arr: TeamSpeakChannel[] = [];

    let chanEmptyCount = 0;
    for (const chan of subChannels) {
        if (chan.totalClients == 0) {
            chanEmptyCount++;
            arr.push(chan);
        }
    }

    console.log("Empty channels: ", arr.map(c => c.name))

    return arr;
}

teamspeak.on("ready", async () => {
    console.log("Conn ready");

    await teamspeak.useByPort(Number(process.env.TS_SERVERPORT));

    setInterval(async () => {
        await checkChannels(process.env.CHAT_PARENT_ID!);
    }, 2 * 1000);

    setInterval(async () => {
        await checkChannels(process.env.TRAINING_PARENT_ID!);
    }, 2 * 1000);
});

async function cleanup(subChannels: TeamSpeakChannel[], parentID: string) {
    let emptyChannels = getEmptyChannels(subChannels);

    for (let i = 0; i < emptyChannels.length - 1; i++) {
        const currChan = emptyChannels[emptyChannels.length - 1 - i];
        await currChan.del();
    }
}

async function checkChannels(parentID: string) {
    const subChannels = await getSubChannels(parentID);
    const emptyChannels = getEmptyChannels(subChannels);

    if (emptyChannels.length > 1) {
        await cleanup(subChannels, parentID);
        return;
    }

    // The training channels are supposed to be called "Chat 1 - n"
    if (parentID == process.env.TRAINING_PARENT_ID) {
        let index = 1;

        // Check that the numbering is consistent (in worst case, have to rename all channels)
        for (const channel of subChannels) {
            if (channel.name != `Training ${index}`) {
                try {
                    await channel.edit({
                        channelName: `Training ${index}`
                    });
                } catch (e) {
                    console.error(`Failed to rename channel... ${e}`);
                }
            }
            index++;
        }

        try {
            const newName = `Training ${index}`;
            if (emptyChannels.length == 0) {
                const chan = await teamspeak.channelCreate(`${newName}`, {
                    cpid: parentID,
                    channelFlagSemiPermanent: true,
                });

                await chan.setPerm({
                    permname: "b_client_force_push_to_talk",
                    permvalue: 0
                });
                return;
            }
        } catch (e) {
            console.error(`Failed to create new channel... ${e}`);
        }
    }

    if (parentID == process.env.CHAT_PARENT_ID) {
        const newName = await getRandomChannelName(parentID);

        if (emptyChannels.length == 0) {
            try {
                const chan = await teamspeak.channelCreate(`${newName}`, {
                    cpid: parentID,
                    channelFlagSemiPermanent: true,
                });

                await chan.setPerm({
                    permname: "b_client_force_push_to_talk",
                    permvalue: 0
                });
                return;
            } catch (e) {
                console.error(`Failed to create new chat channel... ${e}`)
            }
        }
    }
}

teamspeak.on("error", (err) => {
    console.log("err", err);
});
