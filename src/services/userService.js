const User = require("../models/userModel");

// Service Layer = Business logic
class UserService {
    async createUser(data) {
        const user = new User(data);
        return await user.save();
    }

    async getUsers() {
        return await User.find();
    }

    async getUserById(id) {
        return await User.findById(id);
    }

    async updateUser(id, data) {
        return await User.findByIdAndUpdate(id, data, { new: true });
    }

    async deleteUser(id) {
        return await User.findByIdAndDelete(id);
    }
}

module.exports = new UserService();
