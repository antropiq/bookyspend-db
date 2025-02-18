# bookyspend-db

File centric json database engine with only one dependency (uuid)

## Usage example

```javascript
const path = require("path");
const { Database } = require("bookyspend-db");

const db = new Database(path.join(require("os").homedir(), "mydb"))
db.save('users', {
    firstname: 'John',
    lastname: 'Doe',
    age: 34
}).then((doc) => {
    console.log("John doe created with id", doc._id);
});

db.load('users', [
    {type: "equals", property="age", value: 34 }
]).then((docs) => {
    docs.forEach((doc) => {
        console.log("this user is 34 year old!", JSON.stringify(doc))
    })
})
```
