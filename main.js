const _ = require("lodash");

const handleCommand = async function ({
  message,
  fonts,
  api,
  event,
  log,
  Users,
  Threads,
}) {
  const { botPrefix, botAdmins, commands, cooldowns } = global.client;

  try {
    if (!event.body) return; // fixed the mf bug - Liane
    let [command, ...args] = event.body?.trim().split(" ");

    if (command.startsWith(botPrefix)) {
      command = command.slice(botPrefix.length);
    }

    if (event.body.toLowerCase() === "prefix") {
      message.reply(`My prefix is: ${botPrefix}`);
    } else if (event.body) {
      const cmdFile = commands.get(command.toLowerCase());

      if (cmdFile) {
        try {
          if (cmdFile.config.role === 1) {
            if (!_.includes(botAdmins, Number(event.senderID))) {
              return message.reply(
                "❌ | You don't have permission to use this command.",
              );
            }
          }

          const now = Date.now();
          const cooldownKey = `${event.senderID}_${command.toLowerCase()}`;
          const cooldownTime = cmdFile.config.cooldown || 0;
          const cooldownExpiration = cooldowns[cooldownKey] || 0;
          const secondsLeft = Math.ceil((cooldownExpiration - now) / 1000);

          if (cooldownExpiration && now < cooldownExpiration) {
            return message.reply(
              `❌ | Please wait ${secondsLeft}s to use this command!`,
            );
          }

          cooldowns[cooldownKey] = now + cooldownTime * 1000;

          const usePrefix = cmdFile.config.usePrefix !== false;

          if (usePrefix && !event.body.toLowerCase().startsWith(botPrefix)) {
            return;
          }

          await cmdFile.onRun({
            Users,
            Threads,
            cmdName: command && command.toLowerCase(),
            message,
            fonts,
            api,
            event,
            args,
            log,
          });
        } catch (error) {
          log.error(error.stack);
          message.reply(
            `❌ | ${error.message}\n${error.stack}\n${error.name}\n${error.code}\n${error.path}`,
          );
        }
      } else if (event.body?.startsWith(botPrefix)) {
        message.reply(
          `❌ | The command ${command ? `"${command}"` : "that you are using"} doesn't exist, use ${botPrefix}help to view available commands`,
        );
      }
    }
  } catch (error) {
    log.error(error.stack);
    message.reply(
      `❌ | ${error.message}\n${error.stack}\n${error.name}\n${error.code}\n${error.path}`,
    );
  }
};

const handleDatabase = async function ({ event, Users, Threads, log }) {
  try {
    const { allUsers, allThreads } = global.data;
    const { database } = global.client.config;
    let { senderID, threadID } = event;
    senderID = String(senderID);
    threadID = String(threadID);

    if (database === true) {
      if (
        !allUsers.hasOwnProperty(senderID) &&
        !_.includes(allUsers, senderID)
      ) {
        await Users.createData(senderID);
      }

      if (
        event.isGroup &&
        !allThreads.hasOwnProperty(threadID) &&
        !_.includes(allThreads, threadID)
      ) {
        await Threads.createData(threadID);
      }
    } else {
      return null;
    }
  } catch (error) {
    log.error(error);
  }
};

const handleEvent = async function ({
  api,
  message,
  event,
  log,
  fonts,
  Users,
  Threads,
}) {
  const { events } = global.client;

  try {
    for (const { config, onEvent } of events.values()) {
      if (event && config.name) {
        const args = event.body?.split("");
        await onEvent({
          Users,
          Threads,
          api,
          message,
          event,
          log,
          fonts,
          args,
        });
      }
    }
  } catch (error) {
    log.error(error.stack);
    message.reply(
      `❌ | ${error.message}\n${error.stack}\n${error.name}\n${error.code}\n${error.path}`,
    );
  }
};

const handleReply = async function ({
  api,
  fonts,
  event,
  message,
  log,
  Users,
  Threads,
}) {
  const { replies, commands } = global.client;
  const args = event.body.split(" ");

  if (event.messageReply) {
    try {
      const { messageReply: replier = {} } = event;

      if (replies.has(replier.messageID)) {
        const { cmdName, ...data } = replies.get(replier.messageID);
        const cmdFile = commands.get(cmdName);

        await cmdFile.onReply({
          Users,
          Threads,
          api,
          event,
          fonts,
          args,
          message,
          log,
          data: data,
          cmdName,
        });
      }
    } catch (error) {
      log.error(error.stack);
      message.reply(
        `❌ | ${error.message}\n${error.stack}\n${error.name}\n${error.code}\n${error.path}`,
      );
    }
  }
};

module.exports = async function ({ api, event }) {
  const Users = require("./database/Users")({ api });
  const Threads = require("./database/Threads")({ api });
  const fonts = require("./handle/createFonts");
  const log = require("./log");

  global.data = {
    allUsers: Users.getAllUsers(),
    allThreads: Threads.getAllThreads(),
  };

  const { reactions } = global.client;

  const message = {
    react: (emoji) => {
      api.setMessageReaction(emoji, event.messageID, () => {}, true);
    },
    reply: (msg) => {
      return new Promise((res) => {
        api.sendMessage(
          msg,
          event.threadID,
          (_, info) => res(info),
          event.messageID,
        );
      });
    },
    add: (uid) => {
      api.addUserToGroup(uid, event.threadID);
    },
    kick: (uid) => {
      api.removeUserFromGroup(uid, event.threadID);
    },
    send: (msg) => {
      return new Promise((res) => {
        api.sendMessage(msg, event.threadID, (_, info) => res(info));
      });
    },
    edit: (msg, mid) => {
      return new Promise((res) => api.editMessage(msg, mid, () => res(true)));
    },
    waitForReaction: (body, next = "") => {
      return new Promise(async (resolve, reject) => {
        const i = await message.reply(body);
        reactions[i.messageID] = {
          resolve,
          reject,
          event: i,
          next,
          author: event.senderID,
        };
        console.log(`New pending reaction at: `, i, reactions);
      });
    },
  };

  if (event.type == "message_reaction" && reactions[event.messageID]) {
    console.log(`Detected Reaction at ${event.messageID}`);
    const {
      resolve,
      reject,
      event: i,
      author,
      next,
    } = reactions[event.messageID];
    try {
      if (author === event.userID) {
        console.log(
          `${event.reaction} Resolved Reaction at ${event.messageID}`,
        );
        delete reactions[event.messageID];
        if (next) {
          message.edit(next, i.messageID);
        }

        resolve?.(event);
      } else {
        console.log(
          `${event.reaction} Pending Reaction at ${event.messageID} as author not reacted`,
        );
      }
    } catch (err) {
      console.log(err);
      reject?.(err);
    }
  }

  switch (event.type) {
    case "message":
    case "message_reply":
    case "message_unsend":
      handleCommand({
        Users,
        Threads,
        message,
        fonts,
        api,
        event,
        log,
      });
      handleReply({
        Users,
        Threads,
        message,
        fonts,
        api,
        event,
        log,
      });
      handleDatabase({
        api,
        event,
        Users,
        Threads,
        log,
      });
      break;
    case "event":
      handleEvent({
        Users,
        Threads,
        message,
        fonts,
        api,
        event,
        log,
      });
      break;
  }
};
