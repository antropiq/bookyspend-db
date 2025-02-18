const fs = require("fs");
const crypto = require("crypto");
const { v4: uuidv4 } = require("uuid");

const Database = class {
  static DBKEY =
    "1b2de87b967946a733746b9c2a07dd4ddebc688576c9faee38d03b9d375519e2";

  constructor(path, dbkey, useEncryption) {
    logging.log("Database:ctor", "debug", `database path is ${path}`);
    this.path = `${path}`;
    this.dbContent = new Map();
    this.useEncryption = useEncryption || false;
    this.dbkey = dbkey || Database.DBKEY;
    if (!fs.existsSync(this.path)) {
      const dbfile = {
        docs: [],
      };
      fs.writeFileSync(this.path, JSON.stringify(dbfile));
    } else {
      this.readFromDB()
        .then(() => {
          logging.log("Database:ctor", "debug", "Database is loaded");
        })
        .catch((err) => {
          logging.log(
            "Database:ctor",
            "error",
            `Error loading database: ${err}`
          );
        });
    }
  }

  load(dbtypeName, filters) {
    filters = filters || [];
    return new Promise((resolve, reject) => {
      try {
        // Ensure inputs are valid
        if (
          typeof dbtypeName !== "string" ||
          Array.isArray(filters) === false
        ) {
          throw new Error("Invalid input parameters");
        }
        const docs = Array.from(this.dbContent.values());
        try {
          let filteredDocs = docs.filter((doc) => doc.dtype === dbtypeName);

          // Apply all filters in a single pass
          if (filters.length > 0) {
            filteredDocs = filteredDocs.filter((doc) => {
              return filters.every((filter) => {
                if (
                  typeof filter !== "object" ||
                  !filter.type ||
                  !filter.property ||
                  !filter.value
                ) {
                  throw new Error("Invalid filter format");
                }
                switch (filter.type.toLowerCase()) {
                  case "equals":
                    return doc[filter.property] === filter.value;
                  // Add more cases for other filter types if needed
                  default:
                    throw new Error(`Unsupported filter type: ${filter.type}`);
                }
              });
            });
          }

          logging.log(
            "Database::load",
            "debug",
            `Returning ${filteredDocs.length} documents`
          );
          resolve(filteredDocs.length > 0 ? filteredDocs : []);
        } catch (parseErr) {
          reject(
            new Error(`Failed to parse database JSON: ${parseErr.message}`)
          );
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  save(dbtypeName, content) {
    return new Promise((resolve, reject) => {
      if (!content || typeof content !== "object") {
        reject("Invalid document content");
      }
      try {
        if (!content._id || content._id === "") {
          // Generate new ID and add to index
          const doc = {
            _id: uuidv4(),
            dtype: dbtypeName,
            ...content,
          };
          this.dbContent.set(doc._id, doc);
          this.writeToDB().then(() => {
            resolve(doc);
          });
        } else {
          logging.log(
            "Database::save",
            "debug",
            `Updating object with id ${content._id}`
          );
          // Update existing document
          const existingDoc = this.dbContent.get(content._id);
          logging.log(
            "Database::save",
            "debug",
            `indexed document content is ${JSON.stringify(existingDoc)}`
          );
          if (existingDoc) {
            Object.assign(existingDoc, content);
            this.writeToDB().then(() => {
              resolve(content);
            });
          } else {
            reject(`Document with _id ${content._id} not found.`);
          }
        }
      } catch (err) {
        reject(`Error saving document: ${err}`);
      }
    });
  }

  delete(id, bulk) {
    bulk = bulk || "no";
    return new Promise((resolve, reject) => {
      logging.log(
        "Database::delete",
        "debug",
        `Deleting item with id ${id}...`
      );
      try {
        const existingDoc = this.dbContent.get(id);
        if (!existingDoc) {
          reject(`unknown doc ${id}`);
        } else {
          this.dbContent.delete(id);
          if (bulk === "no") {
            this.writeToDB()
              .then(() => {
                logging.log(
                  "Database::delete",
                  "debug",
                  "Item as been removed!"
                );
              })
              .catch((err) => {
                reject(err);
              });
          }
          resolve();
        }
      } catch (err) {
        reject("Database::delete -> " + err);
      }
    });
  }

  deleteByCriteria(dbtypeName, filters) {
    filters = filters || [];
    return new Promise((resolve, reject) => {
      try {
        this.load(dbtypeName, filters)
          .then((docs) => {
            docs.forEach((doc) => {
              // bulk mode = yes
              this.delete(doc._id, "yes")
                .catch((delErr) => {
                  reject(delErr);
                })
                .catch((err) => {
                  reject(err);
                });
            });
            // ok flush to file
            this.writeToDB()
              .then(() => {
                logging.log(
                  "Database::delete",
                  "debug",
                  "Items matching criterias have been removed!"
                );
              })
              .catch((err) => {
                reject(err);
              });
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      } catch (exp) {
        reject(exp);
      }
    });
  }

  readFromDB() {
    return new Promise((resolve, reject) => {
      try {
        const data = fs.readFileSync(this.path, { encoding: "utf-8" });
        let decrypted = data;
        if (this.useEncryption) {
          decrypted = this.decryptData(data);
        }
        const db = JSON.parse(decrypted);
        db.docs.forEach((doc) => this.dbContent.set(doc._id, doc));
        resolve();
      } catch (exp) {
        reject(exp);
      }
    });
  }

  writeToDB() {
    return new Promise((resolve, reject) => {
      try {
        const data = JSON.stringify({
          docs: Array.from(this.dbContent.values()),
        });
        let final = data;
        if (this.useEncryption) {
          final = this.encryptData(data);
        }
        fs.writeFileSync(this.path, final);
        resolve();
      } catch (exp) {
        reject(exp);
      }
    });
  }

  encryptData(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      Buffer.from(this.dbkey, "hex"),
      iv
    );
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    return `${iv.toString("hex")}:${encrypted}`;
  }

  decryptData(ciphertext) {
    const [ivHex, encrypted] = ciphertext.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(this.dbkey, "hex"),
      iv
    );
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  }
};

module.exports = {
  Database,
};
