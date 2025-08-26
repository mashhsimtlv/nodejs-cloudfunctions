const userService = require("../services/userService");

exports.createUser = async (req, res) => {
    try {
        const user = await userService.createUser(req.body);
        res.status(201).json({ success: true, data: user });
    } catch (err) {
        res.status(400).json({ success: false, error: err.message });
    }
};

exports.getUsers = async (req, res) => {
    const users = await userService.getUsers();
    res.json(users);
};

exports.getUserById = async (req, res) => {
    const user = await userService.getUserById(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
};

exports.updateUser = async (req, res) => {
    const user = await userService.updateUser(req.params.id, req.body);
    res.json(user);
};

exports.deleteUser = async (req, res) => {
    await userService.deleteUser(req.params.id);
    res.json({ message: "User deleted" });
};
