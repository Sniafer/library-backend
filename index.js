const {
  ApolloServer,
  AuthenticationError,
  UserInputError,
  gql,
} = require("apollo-server");
const mongoose = require("mongoose");
const { v1: uuid } = require("uuid");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const Book = require("./models/book");
const Author = require("./models/author");
const User = require("./models/user");

const MONGODB_URI = process.env.MONGODB_URI;

console.log("connecting to", MONGODB_URI);

mongoose
  .connect(MONGODB_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
    useCreateIndex: true,
  })
  .then(() => {
    console.log("connected to MongoDB");
  })
  .catch((error) => {
    console.log("error connection to MongoDB:", error.message);
  });

const typeDefs = gql`
  type Book {
    title: String!
    published: Int
    author: Author!
    genres: [String!]!
    id: ID!
  }

  type Author {
    name: String!
    born: Int
    id: ID!
    bookCount: Int
  }

  type User {
    username: String!
    favoriteGenre: String!
    id: ID!
  }

  type Token {
    value: String!
  }

  type Query {
    bookCount: Int!
    authorCount: Int!
    allBooks(author: String, genre: String): [Book!]!
    AllAuthors: [Author!]!
    me: User
  }

  type Mutation {
    addBook(
      title: String!
      author: String!
      published: Int
      genres: [String!]!
    ): Book

    editAuthor(name: String!, born: Int!): Author

    createUser(
      username: String!
      password: String!
      favoriteGenre: String!
    ): User

    login(username: String!, password: String!): Token
  }
`;

const JWT_SECRET = process.env.SECRET;

const resolvers = {
  Query: {
    bookCount: () => Book.collection.countDocuments(),
    authorCount: () => Author.collection.countDocuments(),
    allBooks: async (root, args) => {
      const all = await Book.find({}).populate("author");
      if (!args.author && !args.genre) {
        return all;
      }
      const byAuthor = all.filter((b) => b.author.name === args.author);
      const byGenre = all.filter((b) => b.genres.includes(args.genre));

      if (!args.author) {
        return byGenre;
      }
      if (!args.genre) {
        return byAuthor;
      }
      const compound = byGenre.filter(
        (book) => book.author.name === args.author
      );
      return compound;
    },
    AllAuthors: () => Author.find({}),
    me: (root, args, context) => {
      return context.currentUser;
    },
  },
  Author: {
    bookCount: async (root) => {
      const author = await Author.findOne({ name: root.name });
      const counter = await Book.find({ author: author._id });
      return counter.length;
    },
  },
  Mutation: {
    createUser: async (root, args) => {
      const password = await bcrypt.hash(args.password, 12);
      const user = new User({
        username: args.username,
        password: password,
        favoriteGenre: args.favoriteGenre,
      });

      return user.save().catch((error) => {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        });
      });
    },

    login: async (root, args) => {
      const user = await User.findOne({ username: args.username });

      if (!user) {
        throw new UserInputError("wrong credentials");
      }
      const isValid = await bcrypt.compare(args.password, user.password);
      if (!isValid) {
        throw new Error("Incorrect password ");
      }

      const userForToken = {
        username: user.username,
        id: user._id,
      };

      return { value: jwt.sign(userForToken, JWT_SECRET) };
    },

    addBook: async (root, args, context) => {
      const currentUser = context.currentUser;
      let find = await Author.findOne({ name: args.author });

      if (!currentUser) {
        throw new AuthenticationError("not authenticated");
      }

      if (!find) {
        const author = new Author({ name: args.author });
        find = author;
        try {
          await author.save();
        } catch (error) {
          throw new UserInputError(error.message, {
            invalidArgs: args,
          });
        }
      }

      const book = new Book({
        title: args.title,
        published: args.published,
        author: find,
        genres: args.genres,
      });

      try {
        await book.save();
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        });
      }

      return book;
    },
    editAuthor: async (root, args, context) => {
      const currentUser = context.currentUser;
      const author = await Author.findOne({ name: args.name });
      author.born = args.born;

      if (!currentUser) {
        throw new AuthenticationError("not authenticated");
      }

      try {
        await author.save();
      } catch (error) {
        throw new UserInputError(error.message, {
          invalidArgs: args,
        });
      }
      return author;
    },
  },
};

const server = new ApolloServer({
  typeDefs,
  resolvers,
  context: async ({ req }) => {
    const auth = req ? req.headers.authorization : null;
    if (auth && auth.toLowerCase().startsWith("bearer ")) {
      const decodedToken = jwt.verify(auth.substring(7), JWT_SECRET);
      const currentUser = await User.findById(decodedToken.id);
      return { currentUser };
    }
  },
});

server.listen().then(({ url }) => {
  console.log(`Server ready at ${url}`);
});
